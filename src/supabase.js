// ============================================================
//  Supabase 配置 — 填入你的项目信息（只需要2个值）
//
//  步骤：
//  1. 访问 https://supabase.com → New Project（新建项目）
//  2. 创建完成后，左侧菜单 SQL Editor → 把 supabase_schema.sql
//     里的内容全部粘贴进去执行一次（只需执行一次）
//  3. 左侧菜单 Settings → API
//     复制 "Project URL" 和 "anon public" key 粘贴到下面
// ============================================================

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL     = 'https://weapelgnxrmxqgyrbhkh.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_fdaEY-y7NnpvF0Wej-qZUg_xLW-E_ik';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
