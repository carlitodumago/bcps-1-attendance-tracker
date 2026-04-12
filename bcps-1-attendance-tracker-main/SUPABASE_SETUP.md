# Supabase Integration Setup Guide

This guide will help you set up Supabase for the BCPS-1 Attendance Tracker application.

## Prerequisites

- A Supabase account (free tier available at https://supabase.com)
- Your project created in Supabase

## Step 1: Create a Supabase Project

1. Go to https://supabase.com and sign in
2. Click "New Project"
3. Enter your project details:
   - Organization: Select or create one
   - Project name: `bcps1-attendance-tracker`
   - Database password: Create a secure password
   - Region: Choose the closest to your location (e.g., Southeast Asia for Philippines)
4. Click "Create new project"

## Step 2: Run the Database Schema

1. In your Supabase dashboard, go to the **SQL Editor**
2. Click "New query"
3. Copy the entire contents of [`supabase-schema.sql`](supabase-schema.sql)
4. Paste it into the SQL Editor
5. Click "Run"

This will create all the necessary tables:
- [`officers`](supabase-schema.sql:15) - Stores officer information
- [`duty_records`](supabase-schema.sql:49) - Stores duty time-in/time-out records
- [`scheduled_tasks`](supabase-schema.sql:230) - Stores scheduled status changes

## Step 3: Get Your API Credentials

1. In your Supabase dashboard, go to **Project Settings** (gear icon)
2. Click on **API** in the left sidebar
3. Copy the following values:
   - **Project URL**: `https://your-project-id.supabase.co`
   - **anon/public key**: Starts with `eyJ...`

## Step 4: Configure Environment Variables

1. Copy the example environment file:
   ```bash
   copy .env.example .env
   ```

2. Open `.env` and add your Supabase credentials:
   ```env
   VITE_SUPABASE_URL=https://your-project-id.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key-here
   ```

## Step 5: Enable Authentication (Optional but Recommended)

If you want to add user authentication:

1. Go to **Authentication** > **Providers** in your Supabase dashboard
2. Enable Email provider
3. Configure any additional providers as needed

## Step 6: Test the Connection

1. Start your development server:
   ```bash
   npm run dev
   ```

2. Open your browser's developer console
3. If Supabase is configured correctly, you'll see no warnings
4. If not configured, you'll see a warning but the app will still work with localStorage

## Data Flow

The application uses a unified data layer that automatically:

1. **Uses Supabase when configured**: All data is stored in the cloud with real-time sync
2. **Falls back to localStorage**: If Supabase is not configured, data is stored locally
3. **Seamless switching**: You can switch between modes without data loss

## Database Schema Overview

### Officers Table
```sql
- id: UUID (Primary Key)
- name: TEXT (Required)
- rank: TEXT (Required)
- badge_number: TEXT (Optional)
- unit: TEXT (Default: 'Unassigned')
- current_status: TEXT ('on-duty' or 'off-duty')
- created_at: TIMESTAMPTZ
- updated_at: TIMESTAMPTZ
- created_by: UUID (Reference to auth.users)
- search_vector: TSVECTOR (For full-text search)
```

### Duty Records Table
```sql
- id: UUID (Primary Key)
- officer_id: UUID (Foreign Key to officers)
- duty_date: DATE
- time_in: TIME
- time_out: TIME (Nullable)
- notes: TEXT (Optional)
- created_at: TIMESTAMPTZ
- updated_at: TIMESTAMPTZ
```

### Scheduled Tasks Table
```sql
- id: UUID (Primary Key)
- officer_id: UUID (Foreign Key to officers)
- scheduled_status: TEXT ('off-duty' or 'on-duty')
- scheduled_time: TIMESTAMPTZ
- timezone: TEXT
- status: TEXT ('pending', 'executed', 'cancelled', 'failed')
- created_at: TIMESTAMPTZ
- executed_at: TIMESTAMPTZ (Nullable)
- cancelled_at: TIMESTAMPTZ (Nullable)
- created_by: UUID (Reference to auth.users)
```

## Row Level Security (RLS)

All tables have RLS enabled with policies that allow authenticated users to:
- Read all records
- Insert new records
- Update existing records
- Delete records

For production use, you may want to customize these policies based on your security requirements.

## Stored Procedures

The schema includes several stored procedures:

- [`check_in_officer(officer_id, notes)`](supabase-schema.sql:232) - Creates a new duty record
- [`check_out_officer(officer_id)`](supabase-schema.sql:260) - Closes the active duty record
- [`search_officers(search_term)`](supabase-schema.sql:279) - Full-text search for officers
- [`get_officers_on_duty(date)`](supabase-schema.sql:306) - Get officers on duty for a date
- [`get_duty_stats(start_date, end_date)`](supabase-schema.sql:336) - Get duty statistics

## Views

- [`today_duty_summary`](supabase-schema.sql:132) - Shows today's duty status for all officers
- [`monthly_duty_stats`](supabase-schema.sql:150) - Monthly duty statistics per officer

## Real-time Updates

The application subscribes to real-time changes from Supabase:
- Officers are updated automatically when changed in the database
- Duty records sync in real-time
- Scheduled tasks update across all connected clients

## Troubleshooting

### Connection Issues
- Check that your `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are correct
- Ensure your Supabase project is active (not paused)
- Check browser console for specific error messages

### CORS Errors
- In Supabase dashboard, go to **API** > **URL Configuration**
- Add your development URL to "Additional allowed origins"
- For local development: `http://localhost:5173`

### Data Not Syncing
- Check RLS policies in Supabase dashboard
- Ensure tables have RLS enabled
- Verify your user is authenticated (if using auth)

## Migrating from localStorage

If you have existing data in localStorage:

1. Set up Supabase as described above
2. The app will automatically start using Supabase
3. You can manually migrate data by:
   - Exporting from localStorage (via browser console)
   - Importing into Supabase using the SQL Editor

## Next Steps

1. Set up authentication for user management
2. Configure additional security policies
3. Set up database backups
4. Enable database webhooks for external integrations
