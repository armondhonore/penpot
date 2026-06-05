(ns frontend-tests.tokens.tokens-status-test
  (:require
   [app.common.test-helpers.files :as thf]
   [app.common.test-helpers.ids-map :as thi]
   [app.common.test-helpers.tokens :as tht]
   [app.common.types.tokens-lib :as ctob]
   [app.common.types.tokens-status :as ctos]
   [app.main.data.helpers :as dsh]
   [clojure.test :as t]))

(defn- setup-file-with-tokens
  "Create a file with several token themes and token sets, some active and
  some inactive. Returns the file map with :tokens-lib and :tokens-status
  in its :data."
  []
  (-> (thf/sample-file :file1)
      (tht/add-tokens-lib)
      (tht/update-tokens-lib
       (fn [tokens-lib]
         (-> tokens-lib
             ;; Add token sets
             (ctob/add-set (ctob/make-token-set :id (thi/new-id! :set-active)
                                                :name "set-active"))
             (ctob/add-set (ctob/make-token-set :id (thi/new-id! :set-inactive)
                                                :name "set-inactive"))
             ;; Add themes
             (ctob/add-theme (ctob/make-token-theme :id (thi/new-id! :theme-active)
                                                    :name "theme-active"
                                                    :group "group-1"
                                                    :sets #{"set-active"}))
             (ctob/add-theme (ctob/make-token-theme :id (thi/new-id! :theme-inactive)
                                                    :name "theme-inactive"
                                                    :group "group-1"
                                                    :sets #{"set-inactive"})))))
      (tht/update-tokens-status
       (fn [tokens-status]
         (-> tokens-status
             (ctos/set-tokens-status #{(thi/id :theme-active)}
                                     #{(thi/id :set-active)}))))))

(t/deftest test-tokens-status-active-inactive
  (t/testing "lookup helpers and active checks"
    (let [file          (setup-file-with-tokens)
          state         {:current-file-id (:id file)
                         :current-page-id (thf/current-page-id file)
                         :files {(:id file) file}}
          tokens-status (dsh/lookup-tokens-status state)]

      ;; Theme lookup via tokens-status
      (t/is (ctos/theme-active? tokens-status (thi/id :theme-active))
            "active theme should be active via status")
      (t/is (not (ctos/theme-active? tokens-status (thi/id :theme-inactive)))
            "inactive theme should be inactive via status")

      ;; Set lookup via tokens-status
      (t/is (ctos/set-active? tokens-status (thi/id :set-active))
            "active set should be active via status")
      (t/is (not (ctos/set-active? tokens-status (thi/id :set-inactive)))
            "inactive set should be inactive via status"))))
