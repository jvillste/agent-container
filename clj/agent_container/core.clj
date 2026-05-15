(ns agent-container.core
  (:require [babashka.process :as process]
            [clojure.string :as string]))

(defn pwd []
  (process/shell "pwd"))

(def commands [#'pwd])

(defn -main [& command-line-arguments]
  (try (let [[command-name & arguments] command-line-arguments]
         (if-let [command (first (filter (fn [command]
                                           (= command-name
                                              (name (:name (meta command)))))
                                         commands))]
           (apply command arguments)


           (do (println "Usage:")
               (println "------------------------")
               (println (->> commands
                             (map (fn [command-var]
                                    (str (:name (meta command-var))
                                         ": "
                                         (:arglists (meta command-var))
                                         (when-let [doc (:doc (meta command-var))]
                                           (str "\n" doc)))))
                             (string/join "\n------------------------\n"))))))
       (finally (.flush *out*)
                (shutdown-agents))))
