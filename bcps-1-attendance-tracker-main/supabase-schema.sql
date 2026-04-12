-- ============================================================================
-- BCPS-1 Attendance Tracker - Supabase Database Schema
-- ============================================================================
-- This schema creates tables for officer management and duty record tracking
-- with Row Level Security (RLS) enabled for data protection
-- ============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- TABLE: officers
-- Stores police officer information
-- ============================================================================
CREATE TABLE officers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    rank TEXT NOT NULL,
    badge_number TEXT,
    unit TEXT DEFAULT 'Unassigned',
    current_status TEXT NOT NULL DEFAULT 'off-duty' CHECK (current_status IN ('on-duty', 'off-duty')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Add indexes for officers table
CREATE INDEX idx_officers_name ON officers(name);
CREATE INDEX idx_officers_rank ON officers(rank);
CREATE INDEX idx_officers_status ON officers(current_status);
CREATE INDEX idx_officers_badge_number ON officers(badge_number);
CREATE INDEX idx_officers_created_by ON officers(created_by);

-- Add full-text search for officer search functionality
ALTER TABLE officers ADD COLUMN search_vector tsvector 
    GENERATED ALWAYS AS (
        to_tsvector('english', coalesce(name, '') || ' ' || 
                              coalesce(rank, '') || ' ' || 
                              coalesce(unit, '') || ' ' || 
                              coalesce(badge_number, ''))
    ) STORED;

CREATE INDEX idx_officers_search ON officers USING GIN(search_vector);

-- ============================================================================
-- TABLE: duty_records
-- Stores time-in/time-out records for officers
-- ============================================================================
CREATE TABLE duty_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    officer_id UUID NOT NULL REFERENCES officers(id) ON DELETE CASCADE,
    duty_date DATE NOT NULL,
    time_in TIME NOT NULL,
    time_out TIME,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Ensure time_out is after time_in when provided
    CONSTRAINT valid_time_range CHECK (time_out IS NULL OR time_out > time_in)
);

-- Add indexes for duty_records table
CREATE INDEX idx_duty_records_officer_id ON duty_records(officer_id);
CREATE INDEX idx_duty_records_date ON duty_records(duty_date);
CREATE INDEX idx_duty_records_officer_date ON duty_records(officer_id, duty_date);
CREATE INDEX idx_duty_records_created_at ON duty_records(created_at);

-- ============================================================================
-- FUNCTIONS & TRIGGERS
-- ============================================================================

-- Function to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for officers table
CREATE TRIGGER update_officers_updated_at
    BEFORE UPDATE ON officers
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Trigger for duty_records table
CREATE TRIGGER update_duty_records_updated_at
    BEFORE UPDATE ON duty_records
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Function to update officer status when duty record changes
CREATE OR REPLACE FUNCTION update_officer_status()
RETURNS TRIGGER AS $$
BEGIN
    -- If a new duty record is inserted without time_out, set officer to on-duty
    IF TG_OP = 'INSERT' AND NEW.time_out IS NULL THEN
        UPDATE officers 
        SET current_status = 'on-duty' 
        WHERE id = NEW.officer_id;
    
    -- If a duty record is updated with time_out, set officer to off-duty
    ELSIF TG_OP = 'UPDATE' AND NEW.time_out IS NOT NULL AND OLD.time_out IS NULL THEN
        UPDATE officers 
        SET current_status = 'off-duty' 
        WHERE id = NEW.officer_id;
    
    -- If a duty record is deleted and it was the active one (no time_out)
    ELSIF TG_OP = 'DELETE' AND OLD.time_out IS NULL THEN
        UPDATE officers 
        SET current_status = 'off-duty' 
        WHERE id = OLD.officer_id;
    END IF;
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Trigger to maintain officer status based on duty records
CREATE TRIGGER maintain_officer_status
    AFTER INSERT OR UPDATE OR DELETE ON duty_records
    FOR EACH ROW
    EXECUTE FUNCTION update_officer_status();

-- ============================================================================
-- VIEWS
-- ============================================================================

-- View: Today's duty summary
CREATE VIEW today_duty_summary AS
SELECT 
    o.id as officer_id,
    o.name,
    o.rank,
    o.badge_number,
    o.unit,
    o.current_status,
    dr.id as duty_record_id,
    dr.time_in,
    dr.time_out,
    dr.duty_date
FROM officers o
LEFT JOIN duty_records dr ON o.id = dr.officer_id 
    AND dr.duty_date = CURRENT_DATE
ORDER BY o.name;

-- View: Monthly duty statistics
CREATE VIEW monthly_duty_stats AS
SELECT 
    o.id as officer_id,
    o.name,
    o.rank,
    o.unit,
    DATE_TRUNC('month', dr.duty_date) as month,
    COUNT(DISTINCT dr.duty_date) as days_on_duty,
    COUNT(dr.id) as total_check_ins,
    SUM(
        CASE 
            WHEN dr.time_out IS NOT NULL 
            THEN EXTRACT(EPOCH FROM (dr.time_out - dr.time_in)) / 3600 
            ELSE 0 
        END
    ) as total_hours
FROM officers o
LEFT JOIN duty_records dr ON o.id = dr.officer_id
GROUP BY o.id, o.name, o.rank, o.unit, DATE_TRUNC('month', dr.duty_date)
ORDER BY month DESC, o.name;

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE officers ENABLE ROW LEVEL SECURITY;
ALTER TABLE duty_records ENABLE ROW LEVEL SECURITY;

-- Policy: Allow all users (including anonymous) to read officers
CREATE POLICY "Allow all users to read officers"
    ON officers FOR SELECT
    TO anon, authenticated
    USING (true);

-- Policy: Allow all users (including anonymous) to insert officers
CREATE POLICY "Allow all users to insert officers"
    ON officers FOR INSERT
    TO anon, authenticated
    WITH CHECK (true);

-- Policy: Allow all users (including anonymous) to update officers
CREATE POLICY "Allow all users to update officers"
    ON officers FOR UPDATE
    TO anon, authenticated
    USING (true);

-- Policy: Allow all users (including anonymous) to delete officers
CREATE POLICY "Allow all users to delete officers"
    ON officers FOR DELETE
    TO anon, authenticated
    USING (true);

-- Policy: Allow all users to read duty records
CREATE POLICY "Allow all users to read duty records"
    ON duty_records FOR SELECT
    TO anon, authenticated
    USING (true);

-- Policy: Allow all users to insert duty records
CREATE POLICY "Allow all users to insert duty records"
    ON duty_records FOR INSERT
    TO anon, authenticated
    WITH CHECK (true);

-- Policy: Allow all users to update duty records
CREATE POLICY "Allow all users to update duty records"
    ON duty_records FOR UPDATE
    TO anon, authenticated
    USING (true);

-- Policy: Allow all users to delete duty records
CREATE POLICY "Allow all users to delete duty records"
    ON duty_records FOR DELETE
    TO anon, authenticated
    USING (true);

-- ============================================================================
-- TABLE: scheduled_tasks
-- Stores scheduled status changes for officers
-- ============================================================================
CREATE TABLE scheduled_tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    officer_id UUID NOT NULL REFERENCES officers(id) ON DELETE CASCADE,
    scheduled_status TEXT NOT NULL CHECK (scheduled_status IN ('off-duty', 'on-duty')),
    scheduled_time TIMESTAMPTZ NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'executed', 'cancelled', 'failed')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    executed_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Add indexes for scheduled_tasks table
CREATE INDEX idx_scheduled_tasks_officer_id ON scheduled_tasks(officer_id);
CREATE INDEX idx_scheduled_tasks_status ON scheduled_tasks(status);
CREATE INDEX idx_scheduled_tasks_scheduled_time ON scheduled_tasks(scheduled_time);
CREATE INDEX idx_scheduled_tasks_officer_status ON scheduled_tasks(officer_id, status);

-- Trigger for scheduled_tasks table
CREATE TRIGGER update_scheduled_tasks_updated_at
    BEFORE UPDATE ON scheduled_tasks
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Enable RLS on scheduled_tasks table
ALTER TABLE scheduled_tasks ENABLE ROW LEVEL SECURITY;

-- Policy: Allow all users to read scheduled_tasks
CREATE POLICY "Allow all users to read scheduled_tasks"
    ON scheduled_tasks FOR SELECT
    TO anon, authenticated
    USING (true);

-- Policy: Allow all users to insert scheduled_tasks
CREATE POLICY "Allow all users to insert scheduled_tasks"
    ON scheduled_tasks FOR INSERT
    TO anon, authenticated
    WITH CHECK (true);

-- Policy: Allow all users to update scheduled_tasks
CREATE POLICY "Allow all users to update scheduled_tasks"
    ON scheduled_tasks FOR UPDATE
    TO anon, authenticated
    USING (true);

-- Policy: Allow all users to delete scheduled_tasks
CREATE POLICY "Allow all users to delete scheduled_tasks"
    ON scheduled_tasks FOR DELETE
    TO anon, authenticated
    USING (true);

-- ============================================================================
-- STORED PROCEDURES / FUNCTIONS FOR APP OPERATIONS
-- ============================================================================

-- Function: Check in an officer (Time In)
CREATE OR REPLACE FUNCTION check_in_officer(
    p_officer_id UUID,
    p_notes TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_record_id UUID;
BEGIN
    -- Check if officer already has an open duty record for today
    IF EXISTS (
        SELECT 1 FROM duty_records 
        WHERE officer_id = p_officer_id 
        AND duty_date = CURRENT_DATE 
        AND time_out IS NULL
    ) THEN
        RAISE EXCEPTION 'Officer already checked in today';
    END IF;
    
    -- Create new duty record
    INSERT INTO duty_records (officer_id, duty_date, time_in, notes)
    -- Use local timezone for accurate Philippine time
    VALUES (p_officer_id, CURRENT_DATE, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::time, p_notes)
    RETURNING id INTO v_record_id;
    
    RETURN v_record_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Check out an officer (Time Out)
CREATE OR REPLACE FUNCTION check_out_officer(
    p_officer_id UUID
)
RETURNS VOID AS $$
BEGIN
    -- Update the most recent open duty record for today
    UPDATE duty_records 
    -- Use local timezone for accurate Philippine time
    SET time_out = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::time
    WHERE officer_id = p_officer_id 
    AND duty_date = CURRENT_DATE 
    AND time_out IS NULL;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'No active duty record found for officer today';
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Search officers
CREATE OR REPLACE FUNCTION search_officers(
    p_search_term TEXT
)
RETURNS TABLE (
    id UUID,
    name TEXT,
    rank TEXT,
    badge_number TEXT,
    unit TEXT,
    current_status TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        o.id,
        o.name,
        o.rank,
        o.badge_number,
        o.unit,
        o.current_status
    FROM officers o
    WHERE o.search_vector @@ plainto_tsquery('english', p_search_term)
    ORDER BY ts_rank(o.search_vector, plainto_tsquery('english', p_search_term)) DESC;
END;
$$ LANGUAGE plpgsql;

-- Function: Get officers on duty for a specific date
CREATE OR REPLACE FUNCTION get_officers_on_duty(
    p_date DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
    officer_id UUID,
    name TEXT,
    rank TEXT,
    badge_number TEXT,
    unit TEXT,
    time_in TIME,
    time_out TIME
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        o.id as officer_id,
        o.name,
        o.rank,
        o.badge_number,
        o.unit,
        dr.time_in,
        dr.time_out
    FROM officers o
    INNER JOIN duty_records dr ON o.id = dr.officer_id
    WHERE dr.duty_date = p_date
    ORDER BY dr.time_in;
END;
$$ LANGUAGE plpgsql;

-- Function: Get duty statistics for date range
CREATE OR REPLACE FUNCTION get_duty_stats(
    p_start_date DATE,
    p_end_date DATE
)
RETURNS TABLE (
    duty_date DATE,
    total_officers INTEGER,
    officers_on_duty INTEGER,
    officers_off_duty INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        d.date as duty_date,
        COUNT(DISTINCT o.id)::INTEGER as total_officers,
        COUNT(DISTINCT CASE WHEN dr.time_in IS NOT NULL THEN o.id END)::INTEGER as officers_on_duty,
        COUNT(DISTINCT CASE WHEN dr.time_in IS NULL OR dr.time_out IS NOT NULL THEN o.id END)::INTEGER as officers_off_duty
    FROM generate_series(p_start_date, p_end_date, '1 day'::interval) d(date)
    CROSS JOIN officers o
    LEFT JOIN duty_records dr ON o.id = dr.officer_id AND dr.duty_date = d.date::DATE
    GROUP BY d.date
    ORDER BY d.date;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- SAMPLE DATA (Optional - for testing)
-- Uncomment the following lines to insert sample data
-- ============================================================================

/*
-- Insert sample officers
INSERT INTO officers (name, rank, badge_number, unit, current_status) VALUES
    ('Juan Dela Cruz', 'PO1', '12345', 'Station 1', 'off-duty'),
    ('Maria Santos', 'PO2', '12346', 'Station 1', 'off-duty'),
    ('Pedro Reyes', 'SPO1', '12347', 'Station 2', 'off-duty'),
    ('Ana Garcia', 'PO1', '12348', 'Station 1', 'off-duty'),
    ('Carlos Mendoza', 'PO3', '12349', 'Station 2', 'off-duty');

-- Insert sample duty records
INSERT INTO duty_records (officer_id, duty_date, time_in, time_out) 
SELECT 
    o.id,
    CURRENT_DATE - (random() * 7)::INTEGER,
    ('08:00:00'::TIME + (random() * INTERVAL '2 hours')),
    CASE WHEN random() > 0.3 THEN ('16:00:00'::TIME + (random() * INTERVAL '2 hours')) ELSE NULL END
FROM officers o
CROSS JOIN generate_series(1, 5);
*/

-- ============================================================================
-- END OF SCHEMA
-- ============================================================================
