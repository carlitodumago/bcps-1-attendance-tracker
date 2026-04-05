-- ============================================================================
-- Additional Database Indexes for Performance Optimization
-- Run this in your Supabase SQL Editor to reduce CPU usage
-- ============================================================================

-- ============================================================================
-- Additional Indexes for Officers Table
-- ============================================================================

-- Index for filtering by current_status (frequently used)
CREATE INDEX IF NOT EXISTS idx_officers_current_status ON officers(current_status);

-- Composite index for name search (used in search_officers function)
CREATE INDEX IF NOT EXISTS idx_officers_name_search ON officers USING gin(to_tsvector('english', name));

-- ============================================================================
-- Additional Indexes for Duty Records Table
-- ============================================================================

-- Composite index for officer + date queries (very common pattern)
CREATE INDEX IF NOT EXISTS idx_duty_records_officer_date ON duty_records(officer_id, duty_date DESC);

-- Composite index for finding active duty records
CREATE INDEX IF NOT EXISTS idx_duty_records_active ON duty_records(officer_id, duty_date) WHERE time_out IS NULL;

-- Index for date range queries (calendar views)
CREATE INDEX IF NOT EXISTS idx_duty_records_date_range ON duty_records(duty_date DESC);

-- ============================================================================
-- Additional Indexes for Scheduled Tasks Table
-- ============================================================================

-- Composite index for pending tasks by time
CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_pending_time ON scheduled_tasks(status, scheduled_time) WHERE status = 'pending';

-- ============================================================================
-- Optimized View for Today's Duty (replaces LATERAL with simpler query)
-- ============================================================================

DROP VIEW IF EXISTS today_duty_summary;

CREATE OR REPLACE VIEW today_duty_summary AS
SELECT 
    o.id AS officer_id,
    o.name,
    o.rank,
    o.badge_number,
    o.unit,
    o.current_status,
    dr.id AS duty_record_id,
    dr.time_in,
    dr.time_out,
    dr.duty_date
FROM officers o
LEFT JOIN (
    SELECT 
        dr1.id,
        dr1.officer_id,
        dr1.time_in,
        dr1.time_out,
        dr1.duty_date
    FROM duty_records dr1
    INNER JOIN (
        SELECT officer_id, MAX(duty_date) as max_date
        FROM duty_records
        WHERE duty_date = CURRENT_DATE
        GROUP BY officer_id
    ) dr2 ON dr1.officer_id = dr2.officer_id AND dr1.duty_date = dr2.max_date
) dr ON o.id = dr.officer_id
WHERE o.current_status = 'on-duty';

-- ============================================================================
-- Analyze Tables to Update Statistics
-- ============================================================================

ANALYZE officers;
ANALYZE duty_records;
ANALYZE scheduled_tasks;

-- ============================================================================
-- Display created indexes
-- ============================================================================

SELECT 
    'Index: ' || indexname AS description,
    pg_size_pretty(pg_relation_size(indexname::regclass)) AS size
FROM pg_indexes
WHERE schemaname = 'public'
AND tablename IN ('officers', 'duty_records', 'scheduled_tasks')
ORDER BY pg_relation_size(indexname::regclass) DESC;
