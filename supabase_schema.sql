-- ============================================================
--  真心话大冒险 · Supabase 数据库初始化
--  在 Supabase → SQL Editor 里执行一次即可
-- ============================================================

-- 创建房间表（state 列存储全部游戏状态）
CREATE TABLE IF NOT EXISTS public.rooms (
  code        TEXT PRIMARY KEY,
  state       JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 关闭 RLS（派对游戏，无敏感数据，全员可读写）
ALTER TABLE public.rooms DISABLE ROW LEVEL SECURITY;

-- 开启 Realtime（让客户端实时监听变更）
ALTER PUBLICATION supabase_realtime ADD TABLE public.rooms;

-- ── 原子操作函数（防止多人同时操作造成数据覆盖）──────────────

-- 玩家投票（多人可能同时投，需要原子操作）
CREATE OR REPLACE FUNCTION public.cast_vote(p_code TEXT, p_uid TEXT, p_choice TEXT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.rooms
  SET state = jsonb_set(state, ARRAY['votes', p_uid], to_jsonb(p_choice))
  WHERE code = p_code;
END;
$$;

-- 标记玩家已准备（多人可能同时点，需要原子操作）
CREATE OR REPLACE FUNCTION public.mark_player_ready(p_code TEXT, p_uid TEXT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.rooms
  SET state = jsonb_set(state, ARRAY['players', p_uid, 'ready'], 'true'::jsonb)
  WHERE code = p_code;
END;
$$;

-- 玩家加入房间（防止同时加入覆盖）
CREATE OR REPLACE FUNCTION public.join_room(p_code TEXT, p_uid TEXT, p_name TEXT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.rooms
  SET state = jsonb_set(
    state,
    ARRAY['players', p_uid],
    jsonb_build_object('name', p_name, 'skipChances', 1, 'ready', false)
  )
  WHERE code = p_code AND (state->>'phase') = 'lobby';
END;
$$;
