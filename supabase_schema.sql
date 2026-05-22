-- ============================================================
--  真心话大冒险 · Supabase 数据库初始化
--  在 Supabase → SQL Editor 里新建查询，粘贴全部内容执行一次
-- ============================================================

-- 创建房间表
CREATE TABLE IF NOT EXISTS public.tod_rooms (
  code        TEXT PRIMARY KEY,
  state       JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 关闭 RLS
ALTER TABLE public.tod_rooms DISABLE ROW LEVEL SECURITY;

-- 开启 Realtime
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.tod_rooms;
EXCEPTION WHEN others THEN NULL;
END; $$;

-- 玩家投票（原子操作）
CREATE OR REPLACE FUNCTION public.cast_vote(p_code TEXT, p_uid TEXT, p_choice TEXT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.tod_rooms
  SET state = jsonb_set(state, ARRAY['votes', p_uid], to_jsonb(p_choice))
  WHERE code = p_code;
END;
$$;

-- 标记玩家已准备（原子操作）
CREATE OR REPLACE FUNCTION public.mark_player_ready(p_code TEXT, p_uid TEXT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.tod_rooms
  SET state = jsonb_set(state, ARRAY['players', p_uid, 'ready'], 'true'::jsonb)
  WHERE code = p_code;
END;
$$;

-- 玩家加入房间（原子操作）
CREATE OR REPLACE FUNCTION public.join_room(p_code TEXT, p_uid TEXT, p_name TEXT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.tod_rooms
  SET state = jsonb_set(
    state,
    ARRAY['players', p_uid],
    jsonb_build_object('name', p_name, 'skipChances', 1, 'ready', false)
  )
  WHERE code = p_code AND (state->>'phase') = 'lobby';
END;
$$;
