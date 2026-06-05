;; This Source Code Form is subject to the terms of the Mozilla Public
;; License, v. 2.0. If a copy of the MPL was not distributed with this
;; file, You can obtain one at http://mozilla.org/MPL/2.0/.
;;
;; Copyright (c) KALEIDOS INC Sucursal en España SL

(ns app.common.types.tokens-status
  (:require
   #?(:clj [app.common.fressian :as fres])
   #?(:clj [clojure.data.json :as c.json])
   [app.common.schema :as sm]
   [app.common.schema.generators :as sg]
   [app.common.transit :as t]
   ;;  [app.common.types.tokens-lib :as ctob]
   [clojure.core.protocols :as cp]
   [clojure.datafy :refer [datafy]]
   [clojure.pprint :as pp]))

;; TokensStatus datatype contains the status of the active themes and sets
;; in a tokens library.

(defprotocol ITokensStatus
  ;; (activate-theme [_ tokens-lib theme-id] "Activate a theme and deactivate other themes in the same group. Update active sets.")
  ;; (deactivate-theme [_ tokens-lib theme-id] "Deactivate a theme and update active sets")
  ;; (set-theme-status [_ tokens-lib theme-id status] "Set the activation status of a theme")
  (set-tokens-status [_ theme-ids set-ids] "Set the activation status of the themes and sets")
  (theme-active? [_ theme-id] "Check if a theme is active")
  (get-active-theme-ids [_] "Return a clojure set of active theme ids")
  (get-active-set-ids [_] "Return a clojure set of active set ids")
  ;; (active-themes [_ tokens-lib] "Return an ordered sequence of active themes")
  ;; (activate-set [_ set-id] "Add a set to active sets")
  ;; (deactivate-set [_ set-id] "Remove a set from active sets")
  ;; (toggle-set-active [_ set-id] "Toggle a set in active sets")
  (set-active? [_ set-id] "Check if a set is active"))

(deftype TokensStatus [active-theme-ids active-set-ids]
  cp/Datafiable
  (datafy [_]
    {:active-theme-ids active-theme-ids
     :active-set-ids active-set-ids})

  #?@(:clj
      [c.json/JSONWriter
       (-write [this writter options]
               (c.json/-write (datafy this) writter options))])

  ITokensStatus
  (get-active-theme-ids [_]
    active-theme-ids)

  (get-active-set-ids [_]
    active-set-ids)

  ;;   (activate-theme [this tokens-lib theme-id]
  ;;     ;; (assert (ctob/tokens-lib? tokens-lib) "expected valid tokens-lib")
  ;;     (assert (uuid? theme-id) "expected valid theme-id")
  ;;     (if-not (theme-active? this theme-id)
  ;;       (if-let [theme (ctob/get-theme tokens-lib theme-id)]
  ;;         (let [group-themes      (into #{} (ctob/get-themes-in-group tokens-lib (:group theme)))
  ;;               active-theme-ids' (-> (set/difference active-theme-ids group-themes)
  ;;                                     (conj theme-id))]
  ;;           (TokensStatus. active-theme-ids'
  ;;                          (calculate-active-sets active-theme-ids' tokens-lib)))
  ;;         this)
  ;;       this))
  ;; 
  ;;   (deactivate-theme [this tokens-lib theme-id]
  ;;     ;; (assert (ctob/tokens-lib? tokens-lib) "expected valid tokens-lib")
  ;;     (assert (uuid? theme-id) "expected valid theme-id")
  ;;     (if (theme-active? this theme-id)
  ;;       (let [active-theme-ids' (disj active-theme-ids theme-id)]
  ;;         (TokensStatus. active-theme-ids'
  ;;                        (calculate-active-sets active-theme-ids' tokens-lib)))
  ;;       this))

  ;; (set-theme-status [this tokens-lib theme-id status]
  ;;   (assert (ctob/tokens-lib? tokens-lib) "expected valid tokens-lib")
  ;;   (assert (uuid? theme-id) "expected valid theme-id")
  ;;   (assert (boolean? status) "expected boolean status")
  ;;   (if status
  ;;     (activate-theme this tokens-lib theme-id)
  ;;     (deactivate-theme this tokens-lib theme-id)))

  (set-tokens-status [_ theme-ids set-ids]
    (TokensStatus. theme-ids set-ids))

  (theme-active? [_ theme-id]
    (assert (uuid? theme-id) "expected valid theme-id")
    (contains? active-theme-ids theme-id))

  ;; (active-themes [this tokens-lib]
  ;;   (->> (ctob/get-themes tokens-lib)
  ;;        (filter #(theme-active? this (ctob/get-id %)))))

  ;;   (activate-set [_ set-id]
  ;;     (assert (uuid? set-id) "expected valid set-id")
  ;;     (TokensStatus. active-theme-ids (conj active-set-ids set-id)))
  ;; 
  ;;   (deactivate-set [_ set-id]
  ;;     (assert (uuid? set-id) "expected valid set-id")
  ;;     (TokensStatus. active-theme-ids (disj active-set-ids set-id)))
  ;; 
  ;;   (toggle-set-active [this set-id]
  ;;     (assert (uuid? set-id) "expected valid set-id")
  ;;     (if (contains? active-set-ids set-id)
  ;;       (deactivate-set this set-id)
  ;;       (activate-set this set-id)))

  (set-active? [_ set-id]
    (assert (uuid? set-id) "expected valid set-id")
    (contains? active-set-ids set-id)))

;; === Helper & Predicate ===

(defn map->TokensStatus
  [{:keys [active-theme-ids active-set-ids]}]
  (TokensStatus. active-theme-ids active-set-ids))

(defn tokens-status?
  [o]
  (instance? TokensStatus o))

;; === Schemas, Check functions & Constructor ===

(declare make-tokens-status)

(def schema:tokens-status-attrs
  [:map {:title "TokensStatus"}
   [:active-theme-ids [:set {:gen/max 5} ::sm/uuid]]
   [:active-set-ids [:set {:gen/max 5} ::sm/uuid]]])

(def schema:tokens-status
  [:and {:gen/gen (->> (sg/generator schema:tokens-status-attrs)
                       (sg/fmap #(make-tokens-status %)))}
   [:fn tokens-status?]])

(def ^:private check-tokens-status-attrs
  (sm/check-fn schema:tokens-status-attrs
               :hint "expected valid params for tokens-status"))

(def check-tokens-status
  (sm/check-fn schema:tokens-status
               :hint "expected valid tokens-status"))

(defn make-tokens-status
  [& {:as attrs}]
  (-> attrs
      (update :active-theme-ids #(or % #{}))
      (update :active-set-ids #(or % #{}))
      (check-tokens-status-attrs)
      (map->TokensStatus)))

;; === Pretty-print for debugging ===

(defmethod pp/simple-dispatch TokensStatus [^TokensStatus obj]
  (.write *out* "#penpot/tokens-status ")
  (pp/pprint-newline :miser)
  (pp/pprint (datafy obj)))

#?(:clj
   (do
     (defmethod print-method TokensStatus
       [^TokensStatus this ^java.io.Writer w]
       (.write w "#penpot/tokens-status ")
       (print-method (datafy this) w))

     (defmethod print-dup TokensStatus
       [^TokensStatus this ^java.io.Writer w]
       (print-method this w)))

   :cljs
   (extend-type TokensStatus
     cljs.core/IPrintWithWriter
     (-pr-writer [this writer opts]
       (-write writer "#penpot/tokens-status ")
       (-pr-writer (datafy this) writer opts))

     cljs.core/IEncodeJS
     (-clj->js [this]
       (clj->js (datafy this)))))

;; === Transit serialization ===

(t/add-handlers!
 {:id "penpot/tokens-status"
  :class TokensStatus
  :wfn datafy
  :rfn #(make-tokens-status %)})

;; === Fressian serialization ===

#?(:clj
   (fres/add-handlers!
    {:name "penpot/token-status/v1"
     :class TokensStatus
     :wfn (fn [n w o]
            (fres/write-tag! w n 1)
            (fres/write-object! w (datafy o)))
     :rfn (fn [r]
            (let [obj (fres/read-object! r)]
              (make-tokens-status obj)))}))
