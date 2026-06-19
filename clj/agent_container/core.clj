(ns agent-container.core
  (:require
   [agent-container.docker :as docker]
   [agent-container.network :as network]
   [babashka.fs :as fs]
   [babashka.process :as process]
   [clojure.edn :as edn]
   [clojure.string :as string]
   [clojure.test :refer [deftest is]])
  (:import
   [java.io File]))

(defn get-password [key-name]
  (try
    (:out (process/shell {:out :string} (str "security find-generic-password -s " key-name " -a " key-name " -w")))
    (catch Throwable _throwable
      "")))

(defn- volume-flags [volumes]
  (assert (even? (count volumes))
          "Volumes must be pairs of host-path and container-path")
  (->> volumes
       (partition 2)
       (map (fn [[host-path container-path]]
              (str "-v \"" host-path ":" container-path "\"")))
       (string/join " ")))

(deftest test-volume-flags
  (is (= "-v \"/a:/b\"" (volume-flags ["/a" "/b"])))
  (is (= "-v \"/a:/b\" -v \"/c:/d\"" (volume-flags ["/a" "/b" "/c" "/d"])))
  (is (= "" (volume-flags [])))
  (is (thrown? AssertionError (volume-flags ["/a"]))))

(def configuration-directory (str (System/getenv "HOME")
                                  "/.config/agent-container"))

(defn configuration []
  (-> (str configuration-directory "/configuration.edn")
      (slurp)
      (edn/read-string)))

(defn api-key-environment-value-flag [api-key-name]
  (str "-e " (-> api-key-name
                 (string/upper-case )
                 (string/replace "-" "_"))
       "=\"" (string/trim (get-password api-key-name)) "\""))

(defn run
  "  Runs the agent container. Optionally give arguments as an edn map.

  The only supported parameter is :volumes, which must be a vector of
  source and target paths to be mounted to the container when it is
  created.  Note that if the container already exists, it must be
  removed before the volumes can be mounted.

  an example:
  \"{:volumes [\\\"./resources\\\" \"/resources\"]}\""
  [& [arguments-edn]]
  (let [arguments (edn/read-string arguments-edn)
        configuration (configuration)
        container-name (docker/container-name)
        resources-dir (str (System/getenv "SOURCE_DIRECTORY") "/resources")]
    (if (empty? (:out (process/shell {:out :string :exit? true}
                                     (format "docker ps -a --filter name=^%s$ --format '{{.Names}}'" container-name))))
      (do (println "creating container" container-name)
          (process/shell {:inherit? true}
                         (format (str "docker create
                              --name %s
                              --cap-drop=ALL
                              --cap-add=CHOWN
                              --cap-add=DAC_OVERRIDE
                              --cap-add=FOWNER
                              --cap-add=FSETID
                              --cap-add=SETFCAP
                              --cap-add=SETUID
                              --cap-add=SETGID
                              --security-opt=no-new-privileges
                              --memory=16g
                              --pids-limit=512
                              -v \"%s:/workspace\"
                              -e TAVILY_API_KEY=\"" (get-password "tavily-api-key") "\"
                              %s
                              %s
                              -w /workspace
                              agent-container:latest")
                                 container-name
                                 (docker/current-working-directory)
                                 (volume-flags (:volumes arguments))
                                 (string/join " " (map api-key-environment-value-flag (:api-key-names configuration))))))
      (when (:volumes arguments)
        (println "The container must be removed before mounting volumes.")
        (System/exit 1)))

    (process/shell (format "docker start %s" container-name))
    (process/shell (format "docker cp %s/AGENTS.md %s:/root/.pi/agent/" resources-dir container-name))
    (process/shell (format "docker cp %s/pi-chat %s:/root/bin/" resources-dir container-name))
    (process/shell (format "docker cp %s/models.json %s:/root/.pi/agent/" configuration-directory container-name))
    (doseq [skill-dir (.listFiles (File. (str resources-dir "/skills")))]
      (when (.isDirectory skill-dir)
        (process/shell (format "docker cp %s %s:/root/.pi/agent/skills/%s"
                               skill-dir
                               container-name
                               (.getName skill-dir)))))
    (process/shell (format "docker exec %s touch /root/this-is-an-agent-container" container-name))

    (process/shell (format "docker exec -it --detach-keys=ctrl-z,z %s bash" container-name))

    (process/shell (format "docker stop %s" container-name))))

(defn remove-container
  "  Removes the Docker container."
  {:command-name "remove"}[]
  (process/shell (str "docker rm " (docker/container-name))))

(defn bash
  "  Start bash shell in the running container."
  []
  (process/shell (str "docker exec -it --detach-keys='ctrl-z,z' " (docker/container-name) " bash")))

(defn copy-if-does-not-exists [source-path target-path]
  (when (not (fs/exists? target-path))
    (fs/copy source-path target-path)))

(defn build
  "  Build the container image and copy
  ~/.config/agent-container/settings.json into it. Must be run in the
  agent-container source directory.
  supported arguments:
  :no-cache?: pass \"--no-cache-\" parameter to docker build? Default: false"
  [& [arguments-map-edn]]
  (let [arguments (edn/read-string arguments-map-edn)]
    (fs/create-dirs "temp")
    (fs/copy (str (System/getenv "HOME") "/.config/agent-container/settings.json")
             "temp/user-settings.json"
             {:replace-existing true})
    (process/shell {:inherit? true}
                   (str "docker build "
                        (when (:no-cache? arguments)
                          "--no-cache ")
                        "-t agent-container:latest ."))))

(defn deploy
  "  Creates a symlink in ~/bin/agent-contaienr pointing to the
  agent-container script in this directory and copies default
  configuration files into ~/.config. Must be run in the
  agent-container source directory."
  []
  (let [home-directory (System/getenv "HOME")
        source-directory (System/getenv "SOURCE_DIRECTORY")]
    (process/shell {:inherit? true}
                   (str "ln -sf "
                        source-directory
                        "/agent-container "
                        home-directory
                        "/bin/agent-container"))
    (let [config-directory (str home-directory "/.config/agent-container")]
      (fs/create-dirs config-directory)
      (doseq [file ["configuration.edn" "models.json" "settings.json"]]
        (copy-if-does-not-exists (str source-directory "/resources/" file)
                                 (str config-directory "/" file))))

    (println "Deployment ready.")))

(defn container-name-command
  "  Prints the name of the docker container corresponding to this
  directory."
  {:command-name "container-name"} []
  (println (docker/container-name)))

(def commands [#'run
               #'remove-container
               #'bash
               #'network/restrict-network
               #'network/unrestrict-network
               #'container-name-command
               #'deploy
               #'build])

(defn command-name [command-var]
  (or (:command-name (meta command-var))
      (name (:name (meta command-var)))))

(defn -main [& command-line-arguments]
  (try (let [[given-command-name & arguments] command-line-arguments]
         (if-let [command (first (filter (fn [command]
                                           (= given-command-name
                                              (command-name command)))
                                         commands))]
           (apply command arguments)

           (do (println "Usage:")
               (println "------------------------")
               (println (->> commands
                             (map (fn [command-var]
                                    (str "## "(command-name command-var)
                                         ": "
                                         (:arglists (meta command-var))
                                         (when-let [doc (:doc (meta command-var))]
                                           (str "\n\n" doc)))))
                             (string/join "\n\n"))))))
       (finally (.flush *out*)
                (shutdown-agents))))
