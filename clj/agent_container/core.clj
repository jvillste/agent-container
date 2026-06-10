(ns agent-container.core
  (:require
   [babashka.process :as process]
   [clojure.edn :as edn]
   [clojure.string :as string]
   [clojure.test :refer [deftest is]])
  (:import
   [java.io File]))

(defn basename [path]
  (let [parts (string/split path #"/")]
    (last parts)))

(defn- current-working-directory []
  (System/getProperty "user.dir"))

(defn basename-to-container-name [basename]
  (-> basename
      (string/lower-case)
      (string/replace #"^\." "")
      (string/replace #"[^a-z\-0-9]" "-")))

(deftest test-basename-to-container-name
  (is (= "emacs-d"
         (basename-to-container-name ".emacs-d"))))

(defn container-name []
  (-> (current-working-directory)
      (basename)
      (basename-to-container-name)))

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

(defn run [& arguments]
  (let [container-name (container-name)
        resources-dir (str (System/getenv "HOME") "/agent-container-resources")]

    (when-not (not (empty? (:out (process/shell {:out :string :exit? true}
                                                (format "docker ps -a --filter name=^%s$ --format '{{.Names}}'" container-name)))))
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
                              -e TAVILY_API_KEY=\"" (get-password "tavily-api-key") "\"
                              -e JUKKA_OPENAI_API_KEY=\"" (get-password "jukka-openai-api-key") "\"
                              -e JUKKA_OPENROUTER_API_KEY=\"" (get-password "jukka-openrouter-api-key") "\"
                              -e XAI_API_KEY=\"" (get-password "xai-api-key") "\"
                              -v \"%s:/workspace\"
                              %s
                              -w /workspace
                              agent-container:latest")
                      container-name
                      (current-working-directory)
                      (volume-flags (:volumes (edn/read-string (first arguments)))))))

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

(defn container-name-command {:command-name "container-name"} []
  (println (container-name)))

(def commands [#'run
               #'remove-container
               #'bash
               #'container-name-command])

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
