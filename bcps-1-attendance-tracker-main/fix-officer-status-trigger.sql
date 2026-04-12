-- Fix: Only update officer status for today's duty records, not calendar assignments
-- Run this in Supabase SQL Editor

CREATE OR REPLACE FUNCTION update_officer_status()
RETURNS TRIGGER AS $$
BEGIN
    -- Only update officer status if the duty record is for TODAY
    -- Calendar assignments for other dates should not change officer status
    IF TG_OP = 'INSERT' AND NEW.time_out IS NULL AND NEW.duty_date = CURRENT_DATE THEN
        UPDATE officers 
        SET current_status = 'on-duty' 
        WHERE id = NEW.officer_id;
    
    ELSIF TG_OP = 'UPDATE' AND NEW.time_out IS NOT NULL AND OLD.time_out IS NULL AND NEW.duty_date = CURRENT_DATE THEN
        UPDATE officers 
        SET current_status = 'off-duty' 
        WHERE id = NEW.officer_id;
    
    ELSIF TG_OP = 'DELETE' AND OLD.time_out IS NULL AND OLD.duty_date = CURRENT_DATE THEN
        UPDATE officers 
        SET current_status = 'off-duty' 
        WHERE id = OLD.officer_id;
    END IF;
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;