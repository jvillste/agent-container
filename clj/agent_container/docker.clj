(ns agent-container.docker
  (:require
   [clojure.string :as string]
   [clojure.test :refer [deftest is]]))

(defn- basename [path]
  (let [parts (string/split path #"/")]
    (last parts)))

(defn current-working-directory []
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
