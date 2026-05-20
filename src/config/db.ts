import { createClient } from '@supabase/supabase-js';
import { env } from './env';
import { TABLES } from './tables';

export const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
export { TABLES };
