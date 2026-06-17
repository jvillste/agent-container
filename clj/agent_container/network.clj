(ns agent-container.network
  (:require
   [agent-container.docker :as docker]
   [babashka.process :as process]
   [clojure.string :as string]
   [clojure.test :refer [deftest is]])
  (:import
   [java.net InetAddress URI]
   [java.util Base64]))

(defn- parse-allowed-address [address]
  (let [uri (if (string/includes? address "://")
              (URI. address)
              (URI. (str "tcp://" address)))
        host (.getHost uri)
        port (.getPort uri)]
    (assert (and host
                 (re-matches #"[A-Za-z0-9._-]+" host))
            (str "Allowed address must have a simple host name or IPv4 address: " address))
    (assert (<= 1 port 65535)
            (str "Allowed address must include a port from 1 to 65535: " address))
    {:host host
     :port port}))

(deftest test-parse-allowed-address
  (is (= {:host "host.docker.internal" :port 8888}
         (parse-allowed-address "host.docker.internal:8888")))
  (is (= {:host "host.docker.internal" :port 8888}
         (parse-allowed-address "http://host.docker.internal:8888")))
  (is (thrown? AssertionError (parse-allowed-address "example.com"))))

(defn- docker-inspect [format-string]
  (string/trim (:out (process/shell {:out :string}
                                     (format "docker inspect -f '%s' %s"
                                             format-string
                                             (docker/container-name))))))

(defn- container-ip []
  (docker-inspect "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}"))

(defn- container-gateway []
  (docker-inspect "{{range .NetworkSettings.Networks}}{{.Gateway}}{{end}}"))

(defn- resolve-allowed-host [host]
  (if (= "host.docker.internal" host)
    (container-gateway)
    (.getHostAddress (InetAddress/getByName host))))

(defn- macos? []
  (string/includes? (string/lower-case (System/getProperty "os.name"))
                    "mac"))

(defn- ipv4-address? [host]
  (boolean (re-matches #"\d+\.\d+\.\d+\.\d+" host)))

(defn- shell-quote [text]
  (str "'" (string/replace text #"'" (constantly "'\\''")) "'"))

(deftest test-shell-quote
  (is (= "'abc'"
         (shell-quote "abc")))
  (is (= "'can'\\''t'"
         (shell-quote "can't"))))

(defn- encoded-script [script]
  (.encodeToString (Base64/getEncoder) (.getBytes script "UTF-8")))

(defn- run-script-command [prefix script]
  (str "printf %s "
       (shell-quote (encoded-script script))
       " | "
       prefix
       " sh -c 'base64 -d | sh'"))

(defn- target-shell [script]
  (process/shell {:inherit? true}
                 "sh"
                 "-c"
                 (run-script-command (str "docker exec -i "
                                          (docker/container-name))
                                     script)))

(defn- target-shell-out [script]
  (string/trim (:out (process/shell {:out :string}
                                     "sh"
                                     "-c"
                                     (run-script-command (str "docker exec -i "
                                                              (docker/container-name))
                                                         script)))))

(defn- network-namespace-shell [script]
  (process/shell {:inherit? true}
                 "sh"
                 "-c"
                 (run-script-command (str "docker run --rm -i --network container:"
                                          (docker/container-name)
                                          " --cap-add NET_ADMIN agent-container:latest")
                                     script)))

(defn- resolve-allowed-host-in-container [host]
  (if (ipv4-address? host)
    host
    (let [address (target-shell-out (str "getent ahostsv4 "
                                         (shell-quote host)
                                         " | awk '{print $1; exit}'"))]
      (assert (not (string/blank? address))
              (str "Could not resolve allowed host from container: " host))
      address)))

(defn- iptables-comment []
  (str "agent-container:" (docker/container-name)))

(defn- iptables-rule-lines []
  (->> (string/split-lines (:out (process/shell {:out :string} "sudo iptables -S DOCKER-USER")))
       (filter #(string/includes? % (str "--comment \"" (iptables-comment) "\"")))))

(defn- add-iptables-rule [rule]
  (process/shell {:inherit? true}
                 (str "sudo iptables -I DOCKER-USER " rule " -m comment --comment \"" (iptables-comment) "\"")))

(defn- delete-iptables-rule-line [rule-line]
  (process/shell {:inherit? true}
                 (str "sudo iptables "
                      (string/replace-first rule-line #"^-A DOCKER-USER " "-D DOCKER-USER "))))

(def namespace-chain-name
  "AGENT_CONTAINER")

(defn- namespace-unrestrict-network []
  (network-namespace-shell (format "iptables -D OUTPUT -j %s 2>/dev/null || true
iptables -F %s 2>/dev/null || true
iptables -X %s 2>/dev/null || true"
                                   namespace-chain-name
                                   namespace-chain-name
                                   namespace-chain-name)))

(def hosts-begin-marker
  "# agent-container-hosts-begin")

(def hosts-end-marker
  "# agent-container-hosts-end")

(defn- remove-host-entries []
  (target-shell (format "awk 'BEGIN {skip=0}
$0 == \"%s\" {skip=1; next}
$0 == \"%s\" {skip=0; next}
skip == 0 {print}' /etc/hosts > /tmp/agent-container-hosts
cat /tmp/agent-container-hosts > /etc/hosts
rm -f /tmp/agent-container-hosts"
                        hosts-begin-marker
                        hosts-end-marker)))

(defn- host-entry [{:keys [host address]}]
  (when-not (ipv4-address? host)
    (str address " " host)))

(defn- add-host-entries [resolved-addresses]
  (remove-host-entries)
  (let [entries (keep host-entry resolved-addresses)]
    (when (seq entries)
      (target-shell (str "cat >> /etc/hosts <<'EOF'\n"
                         hosts-begin-marker
                         "\n"
                         (string/join "\n" entries)
                         "\n"
                         hosts-end-marker
                         "\nEOF")))))

(defn- namespace-allow-rule [{:keys [address port]}]
  (format "iptables -A %s -p tcp -d %s --dport %s -j ACCEPT"
          namespace-chain-name
          address
          port))

(defn- namespace-restrict-script [resolved-addresses]
  (string/join "\n"
               (concat [(format "iptables -N %s" namespace-chain-name)
                        (format "iptables -I OUTPUT 1 -j %s" namespace-chain-name)
                        (format "iptables -A %s -o lo -j ACCEPT" namespace-chain-name)
                        (format "iptables -A %s -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT" namespace-chain-name)]
                       (map namespace-allow-rule resolved-addresses)
                       [(format "iptables -A %s -j REJECT" namespace-chain-name)])))

(deftest test-namespace-restrict-script
  (is (string/includes? (namespace-restrict-script [{:address "1.2.3.4" :port 443}])
                        "iptables -A AGENT_CONTAINER -p tcp -d 1.2.3.4 --dport 443 -j ACCEPT")))

(defn- restrict-network-in-container-namespace [allowed-addresses]
  (let [resolved-addresses (doall (map (fn [{:keys [host port]}]
                                      {:host host
                                       :address (resolve-allowed-host-in-container host)
                                       :port port})
                                    (map parse-allowed-address allowed-addresses)))]
    (namespace-unrestrict-network)
    (add-host-entries resolved-addresses)
    (network-namespace-shell (namespace-restrict-script resolved-addresses))))

(defn- unrestrict-network-on-linux-host []
  (doseq [rule-line (iptables-rule-lines)]
    (delete-iptables-rule-line rule-line)))

(defn- restrict-network-on-linux-host [allowed-addresses]
  (unrestrict-network-on-linux-host)
  (let [source-ip (container-ip)]
    (assert (not (string/blank? source-ip))
            (str "Container is not running or has no IP address: " (docker/container-name)))
    (add-iptables-rule (format "-s %s -j DROP" source-ip))
    (add-iptables-rule (format "-s %s -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT" source-ip))
    (doseq [{:keys [host port]} (map parse-allowed-address allowed-addresses)]
      (add-iptables-rule (format "-s %s -d %s -p tcp --dport %s -j ACCEPT"
                                  source-ip
                                  (resolve-allowed-host host)
                                  port)))))

(defn unrestrict-network
  "  Remove firewall rules."
  []
  (if (macos?)
    (do (namespace-unrestrict-network)
        (remove-host-entries))
    (unrestrict-network-on-linux-host)))

(defn restrict-network
  "  Creates firewall rules to the running containers network namespace that only allow connections to the given domain port pairs.
  for example to allow access to the local omlx server, include host.docker.internal:8888"
  [& allowed-addresses]
  (assert (seq allowed-addresses)
          "Give at least one allowed address, for example: host.docker.internal:8888")
  (if (macos?)
    (restrict-network-in-container-namespace allowed-addresses)
    (restrict-network-on-linux-host allowed-addresses)))
