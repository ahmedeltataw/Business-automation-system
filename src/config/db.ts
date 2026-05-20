/**
 * Database Configuration
 *
 * Initializes the Supabase client and exports centralized table names.
 * All database access flows through this single module.
 */

import { createClient } from '@supabase/supabase-js';
import { env } from './env';
import { TABLES } from './tables';

/** Supabase client initialized from environment variables */
export const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
export { TABLES };
