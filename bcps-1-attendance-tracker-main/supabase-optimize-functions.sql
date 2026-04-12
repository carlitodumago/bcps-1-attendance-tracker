-- ============================================================================
-- Optimized Monthly Duty Stats View
-- Uses materialized approach for better performance with large datasets
-- ============================================================================

-- Drop existing view
DROP VIEW IF EXISTS monthly_duty_stats;

-- Create optimized view using subqueries
CREATE OR REPLACE VIEW monthly_duty_stats AS
SELECT 
    o.id AS officer_id,
    o.name,
    o.rank,
    o.unit,
    TO_CHAR(dr.duty_date, 'YYYY-MM') AS month,
    COUNT(DISTINCT dr.duty_date) AS days_on_duty,
    COUNT(dr.id) AS total_check_ins,
    COALESCE(
        SUM(
            CASE 
                WHEN dr.time_out IS NOT NULL 
                THEN EXTRACT(EPOCH FROM (dr.time_out::timestamp - dr.time_in::timestamp))/3600 
                ELSE 0 
            END
        ),
        0
    ) AS total_hours
FROM officers o
LEFT JOIN (
    SELECT 
        officer_id, 
        duty_date,
        id,
        time_in,
        time_out
    FROM duty_records
    WHERE duty_date >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '12 months')
) dr ON o.id = dr.officer_id
GROUP BY o.id, o.name, o.rank, o.unit, month;

-- ============================================================================
-- Optimized Get Officers On Duty Function
-- ============================================================================

DROP FUNCTION IF EXISTS get_officers_on_duty(TEXT);

CREATE OR REPLACE FUNCTION get_officers_on_duty(p_date TEXT DEFAULT NULL)
RETURNS TABLE (
    officer_id UUID,
    name TEXT,
    rank TEXT,
    badge_number TEXT,
    unit TEXT,
    time_in TEXT,
    time_out TEXT
) AS $$
DECLARE
    v_date TEXT;
BEGIN
    IF p_date IS NULL THEN
        v_date := CURRENT_DATE::TEXT;
    ELSE
        v_date := p_date;
    END IF;
    
    RETURN QUERY
    SELECT 
        o.id AS officer_id,
        o.name,
        o.rank,
        o.badge_number,
        o.unit,
        dr.time_in,
        dr.time_out
    FROM officers o
    INNER JOIN (
        SELECT officer_id, time_in, time_out
        FROM duty_records
        WHERE duty_date = v_date::DATE 
        AND time_out IS NULL
    ) dr ON o.id = dr.officer_id
    ORDER BY dr.time_in;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- Optimized Get Duty Stats Function
-- ============================================================================

DROP FUNCTION IF EXISTS get_duty_stats(TEXT, TEXT);

CREATE OR REPLACE FUNCTION get_duty_stats(p_start_date TEXT, p_end_date TEXT)
RETURNS TABLE (
    duty_date DATE,
    total_officers BIGINT,
    officers_on_duty BIGINT,
    officers_off_duty BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        dr.duty_date,
        COUNT(DISTINCT o.id)::BIGINT AS total_officers,
        COUNT(DISTINCT CASE WHEN dr.time_out IS NULL THEN o.id END)::BIGINT AS officers_on_duty,
        COUNT(DISTINCT CASE WHEN dr.time_out IS NOT NULL THEN o.id END)::BIGINT AS officers_off_duty
    FROM officers o
    LEFT JOIN (
        SELECT officer_id, duty_date, time_out
        FROM duty_records
        WHERE duty_date BETWEEN p_start_date::DATE AND p_end_date::DATE
    ) dr ON o.id = dr.officer_id
    GROUP BY dr.duty_date
    ORDER BY dr.duty_date DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- End of Optimized Functions
-- ============================================================================
