(ns agent-container.network
  (:require
   [agent-container.docker :as docker]
   [babashka.process :as process]
   [clojure.string :as string]
   [clojure.test :refer [deftest is]])
  (:import
   [java.net InetAddress URI]))

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

(defn unrestrict-network {:command-name "unrestrict-network"} []
  (doseq [rule-line (iptables-rule-lines)]
    (delete-iptables-rule-line rule-line)))

(defn restrict-network {:command-name "restrict-network"} [& allowed-addresses]
  (assert (seq allowed-addresses)
          "Give at least one allowed address, for example: host.docker.internal:8888")
  (unrestrict-network)
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
