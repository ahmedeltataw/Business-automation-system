/**
 * Release Scheduler Lock
 *
 * Manually releases a stuck scheduler lock in Supabase.
 * Use when the autopilot crashes mid-cycle and leaves the lock active.
 *
 * Usage: npx ts-node release_lock.ts
 */

import { supabase } from './src/config/db';

async function release(): Promise<void> {
  const { error } = await supabase
    .from('scheduler_lock')
    .update({ is_running: false, last_run_status: 'manual_release' })
    .eq('id', 'main');
  if (error) console.error(error);
  else console.log('Lock released successfully');
}

release();
