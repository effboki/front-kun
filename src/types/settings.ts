// src/types/settings.ts
/** 店舗設定の型定義 */
export interface StoreSettings {
    eatOptions: string[];
  drinkOptions: string[];
  courses: any[];
  tables: any[];
  // ここに店舗設定画面の各設定項目をキーと値の型で列挙してください
  // 例:
  // courses: { name: string; tasks: Task[] }[];
  // tables: string[];
  // isAllYouCanEatEnabled: boolean;
  // ...
}
