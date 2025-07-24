export interface StoreSettings {
  /** 食べ放題オプション */
  eatOptions?: string[];
  /** 飲み放題オプション */
  drinkOptions?: string[];
  /** コース一覧 */
  courses?: any[];
  /** テーブル一覧 */
  tables?: any[];
  /** ポジション名のリスト。未定義時は空配列で扱う */
  positions?: string[];
  /**
   * ポジションごとのタスクマップ。
   * 例:
   * {
   *   "ホール":   { "開店前": ["テーブル拭き"], "営業中": ["配膳"] },
   *   "キッチン": { "仕込み": ["カレー準備"] }
   * }
   */
  tasksByPosition?: Record<string, Record<string, string[]>>;
}