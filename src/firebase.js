// ============================================================
//  Firebase 配置 — 使用前请填入你自己的 Firebase 项目信息
//
//  步骤：
//  1. 访问 https://console.firebase.google.com
//  2. 新建项目（随便起名）
//  3. 点左侧 "构建" → "Realtime Database" → "创建数据库"
//     选 "测试模式"（允许读写，适合派对游戏）
//  4. 点左侧 "项目设置" → "您的应用" → 点 </> 图标注册 Web 应用
//  5. 复制 firebaseConfig 里的内容粘贴到下方
// ============================================================

import { initializeApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';

const firebaseConfig = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT.firebaseapp.com",
  databaseURL:       "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID",
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
