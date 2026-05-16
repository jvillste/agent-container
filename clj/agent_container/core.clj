(ns agent-container.core
  (:require [babashka.process :as process]
            [clojure.string :as string])
  (:import [java.io File]))

(defn basename [path]
  (let [parts (string/split path #"/")]
    (last parts)))

(defn- current-working-directory []
  (System/getProperty "user.dir"))

(defn container-name []
  (basename (current-working-directory)))

(defn get-password [key-name]
  (:out (process/shell {:out :string} (str "security find-generic-password -s " key-name " -a " key-name " -w"))))

(defn run []
  (let [current-working-directory (current-working-directory)
        container-name (basename current-working-directory)
        resources-dir (str (System/getenv "HOME") "/agent-container-resources")
        container-exists? (not (empty? (:out (process/shell {:out :string :exit? true}
                                                            (format "docker ps -a --filter name=^%s$ --format '{{.Names}}'" container-name)))))]
    (when-not container-exists?
      (println "creating container" container-name)
      (process/shell {:inherit? true}
                     (format
                      (str "docker create
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
                              -e TAVILY_API_KEY=\"$(security find-generic-password -s travily-api-key -a travily-api-key -w)\"
                              -e JUKKA_OPENAI_API_KEY=\"" (get-password "jukka-openai-api-key") "\"
                              -e JUKKA_HUGGINGFACE_API_KEY=\"$(security find-generic-password -s jukka-huggingface-api-key -a jukka-huggingface-api-key -w)\"
                              -e JUKKA_OPENROUTER_API_KEY=\"$(security find-generic-password -s jukka-openrouter-api-key -a jukka-openrouter-api-key -w)\"
                              -v \"%s:/workspace\"
                              -w /workspace
                              agent-container:latest")
                      container-name
                      current-working-directory))

      (process/shell (format "docker cp %s/settings.json %s:/root/.pi/agent/" resources-dir container-name)))

    (process/shell (format "docker start %s" container-name))
    (process/shell (format "docker cp %s/AGENTS.md %s:/root/.pi/agent/" resources-dir container-name))
    (process/shell (format "docker cp %s/models.json %s:/root/.pi/agent/" resources-dir container-name))
    (doseq [skill-dir (.listFiles (File. (str resources-dir "/skills")))]
      (when (.isDirectory skill-dir)
        (process/shell (format "docker cp %s %s:/root/.pi/agent/skills/%s"
                               skill-dir
                               container-name
                               (.getName skill-dir)))))
    (process/shell (format "docker exec %s touch /root/this-is-an-agent-container" container-name))

    (process/shell (format "docker exec -it --detach-keys=ctrl-z,z %s bash" container-name))

    (process/shell (format "docker stop %s" container-name))))

(defn remove-container {:command-name "remove"}[]
  (process/shell (str "docker rm " (container-name))))

(defn bash []
  (process/shell (str "docker exec -it --detach-keys='ctrl-z,z' " (container-name) " bash")))

(def commands [#'run
               #'remove-container
               #'bash])

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
                                    (str (command-name command-var)
                                         ": "
                                         (:arglists (meta command-var))
                                         (when-let [doc (:doc (meta command-var))]
                                           (str "\n" doc)))))
                             (string/join "\n------------------------\n"))))))
       (finally (.flush *out*)
                (shutdown-agents))))
