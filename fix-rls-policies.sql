-- ============================================================================
-- Fix RLS Policies to Allow Anonymous Access
-- Run this in your Supabase SQL Editor
-- ============================================================================

-- Drop existing policies for officers table
DROP POLICY IF EXISTS "Allow authenticated users to read officers" ON officers;
DROP POLICY IF EXISTS "Allow authenticated users to insert officers" ON officers;
DROP POLICY IF EXISTS "Allow authenticated users to update officers" ON officers;
DROP POLICY IF EXISTS "Allow authenticated users to delete officers" ON officers;
DROP POLICY IF EXISTS "Allow all users to read officers" ON officers;
DROP POLICY IF EXISTS "Allow all users to insert officers" ON officers;
DROP POLICY IF EXISTS "Allow all users to update officers" ON officers;
DROP POLICY IF EXISTS "Allow all users to delete officers" ON officers;

-- Create new policies for officers table (allow anonymous access)
CREATE POLICY "Allow all users to read officers"
    ON officers FOR SELECT
    TO anon, authenticated
    USING (true);

CREATE POLICY "Allow all users to insert officers"
    ON officers FOR INSERT
    TO anon, authenticated
    WITH CHECK (true);

CREATE POLICY "Allow all users to update officers"
    ON officers FOR UPDATE
    TO anon, authenticated
    USING (true);

CREATE POLICY "Allow all users to delete officers"
    ON officers FOR DELETE
    TO anon, authenticated
    USING (true);

-- Drop existing policies for duty_records table
DROP POLICY IF EXISTS "Allow authenticated users to read duty records" ON duty_records;
DROP POLICY IF EXISTS "Allow authenticated users to insert duty records" ON duty_records;
DROP POLICY IF EXISTS "Allow authenticated users to update duty records" ON duty_records;
DROP POLICY IF EXISTS "Allow authenticated users to delete duty records" ON duty_records;
DROP POLICY IF EXISTS "Allow all users to read duty records" ON duty_records;
DROP POLICY IF EXISTS "Allow all users to insert duty records" ON duty_records;
DROP POLICY IF EXISTS "Allow all users to update duty records" ON duty_records;
DROP POLICY IF EXISTS "Allow all users to delete duty records" ON duty_records;

-- Create new policies for duty_records table (allow anonymous access)
CREATE POLICY "Allow all users to read duty records"
    ON duty_records FOR SELECT
    TO anon, authenticated
    USING (true);

CREATE POLICY "Allow all users to insert duty records"
    ON duty_records FOR INSERT
    TO anon, authenticated
    WITH CHECK (true);

CREATE POLICY "Allow all users to update duty records"
    ON duty_records FOR UPDATE
    TO anon, authenticated
    USING (true);

CREATE POLICY "Allow all users to delete duty records"
    ON duty_records FOR DELETE
    TO anon, authenticated
    USING (true);

-- Drop existing policies for scheduled_tasks table
DROP POLICY IF EXISTS "Allow authenticated users to read scheduled_tasks" ON scheduled_tasks;
DROP POLICY IF EXISTS "Allow authenticated users to insert scheduled_tasks" ON scheduled_tasks;
DROP POLICY IF EXISTS "Allow authenticated users to update scheduled_tasks" ON scheduled_tasks;
DROP POLICY IF EXISTS "Allow authenticated users to delete scheduled_tasks" ON scheduled_tasks;
DROP POLICY IF EXISTS "Allow all users to read scheduled_tasks" ON scheduled_tasks;
DROP POLICY IF EXISTS "Allow all users to insert scheduled_tasks" ON scheduled_tasks;
DROP POLICY IF EXISTS "Allow all users to update scheduled_tasks" ON scheduled_tasks;
DROP POLICY IF EXISTS "Allow all users to delete scheduled_tasks" ON scheduled_tasks;

-- Create new policies for scheduled_tasks table (allow anonymous access)
CREATE POLICY "Allow all users to read scheduled_tasks"
    ON scheduled_tasks FOR SELECT
    TO anon, authenticated
    USING (true);

CREATE POLICY "Allow all users to insert scheduled_tasks"
    ON scheduled_tasks FOR INSERT
    TO anon, authenticated
    WITH CHECK (true);

CREATE POLICY "Allow all users to update scheduled_tasks"
    ON scheduled_tasks FOR UPDATE
    TO anon, authenticated
    USING (true);

CREATE POLICY "Allow all users to delete scheduled_tasks"
    ON scheduled_tasks FOR DELETE
    TO anon, authenticated
    USING (true);

-- ============================================================================
-- END OF SCRIPT
-- ============================================================================
