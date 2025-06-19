// seedFirestore.js → いったん localStorage 用に変換
(function seed() {
  const defaultData = {
    courses: [
      {
        name: 'スタンダード',
        tasks: [
          { timeOffset: 0,  label: 'コース説明',     bgColor: 'bg-gray-100/80' },
          { timeOffset: 45, label: 'クルー',         bgColor: 'bg-orange-200/80' },
          { timeOffset: 60, label: 'リクエスト',     bgColor: 'bg-blue-200/80' },
          { timeOffset: 90, label: 'ラストオーダー', bgColor: 'bg-pink-200/80' },
          { timeOffset: 120,label: '退席',           bgColor: 'bg-gray-200/80' },
        ],
      },
      {
        name: 'ランチ',
        tasks: [
          { timeOffset: 0,  label: 'コース説明',     bgColor: 'bg-gray-100/80' },
          { timeOffset: 30, label: 'カレー',         bgColor: 'bg-yellow-200/80' },
          { timeOffset: 50, label: 'リクエスト',     bgColor: 'bg-blue-200/80' },
          { timeOffset: 80, label: 'ラストオーダー', bgColor: 'bg-pink-200/80' },
          { timeOffset: 110,label: '退席',           bgColor: 'bg-gray-200/80' },
        ],
      },
      {
        name: 'ディナー',
        tasks: [
          { timeOffset: 0,  label: 'コース説明',     bgColor: 'bg-gray-100/80' },
          { timeOffset: 10, label: '皿ピメ',         bgColor: 'bg-yellow-200/80' },
          { timeOffset: 45, label: 'カレー',         bgColor: 'bg-orange-200/80' },
          { timeOffset: 70, label: 'リクエスト',     bgColor: 'bg-blue-200/80' },
          { timeOffset: 95, label: 'ラストオーダー', bgColor: 'bg-pink-200/80' },
          { timeOffset: 125,label: '退席',           bgColor: 'bg-gray-200/80' },
        ],
      },
    ],
    tables: ['1', '2', '3', '4', '5', '6'],
    reservations: [],
  };

  // localStorage に初期データを書き込む
  localStorage.setItem(
    'front-kun-storeSettings',
    JSON.stringify({
      courses: defaultData.courses,
      tables: defaultData.tables,
    })
  );
  localStorage.setItem(
    'front-kun-reservations',
    JSON.stringify(defaultData.reservations)
  );

  console.log('✅ localStorage に初期データを登録しました');
})();