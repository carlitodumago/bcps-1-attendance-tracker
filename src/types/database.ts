// ============================================================================
// Supabase Database Types
// Generated based on supabase-schema.sql
// ============================================================================

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      officers: {
        Row: {
          id: string;
          name: string;
          rank: string;
          badge_number: string | null;
          unit: string;
          current_status: 'on-duty' | 'off-duty';
          created_at: string;
          updated_at: string;
          created_by: string | null;
          search_vector: unknown | null;
        };
        Insert: {
          id?: string;
          name: string;
          rank: string;
          badge_number?: string | null;
          unit?: string;
          current_status?: 'on-duty' | 'off-duty';
          created_at?: string;
          updated_at?: string;
          created_by?: string | null;
          search_vector?: unknown | null;
        };
        Update: {
          id?: string;
          name?: string;
          rank?: string;
          badge_number?: string | null;
          unit?: string;
          current_status?: 'on-duty' | 'off-duty';
          created_at?: string;
          updated_at?: string;
          created_by?: string | null;
          search_vector?: unknown | null;
        };
        Relationships: [
          {
            foreignKeyName: 'officers_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          }
        ];
      };
      duty_records: {
        Row: {
          id: string;
          officer_id: string;
          duty_date: string;
          time_in: string;
          time_out: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          officer_id: string;
          duty_date: string;
          time_in: string;
          time_out?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          officer_id?: string;
          duty_date?: string;
          time_in?: string;
          time_out?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'duty_records_officer_id_fkey';
            columns: ['officer_id'];
            isOneToOne: false;
            referencedRelation: 'officers';
            referencedColumns: ['id'];
          }
        ];
      };
      scheduled_tasks: {
        Row: {
          id: string;
          officer_id: string;
          scheduled_status: 'off-duty' | 'on-duty';
          scheduled_time: string;
          timezone: string;
          status: 'pending' | 'executed' | 'cancelled' | 'failed';
          created_at: string;
          executed_at: string | null;
          cancelled_at: string | null;
          created_by: string | null;
        };
        Insert: {
          id?: string;
          officer_id: string;
          scheduled_status: 'off-duty' | 'on-duty';
          scheduled_time: string;
          timezone?: string;
          status?: 'pending' | 'executed' | 'cancelled' | 'failed';
          created_at?: string;
          executed_at?: string | null;
          cancelled_at?: string | null;
          created_by?: string | null;
        };
        Update: {
          id?: string;
          officer_id?: string;
          scheduled_status?: 'off-duty' | 'on-duty';
          scheduled_time?: string;
          timezone?: string;
          status?: 'pending' | 'executed' | 'cancelled' | 'failed';
          created_at?: string;
          executed_at?: string | null;
          cancelled_at?: string | null;
          created_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'scheduled_tasks_officer_id_fkey';
            columns: ['officer_id'];
            isOneToOne: false;
            referencedRelation: 'officers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'scheduled_tasks_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          }
        ];
      };
    };
    Views: {
      today_duty_summary: {
        Row: {
          officer_id: string | null;
          name: string | null;
          rank: string | null;
          badge_number: string | null;
          unit: string | null;
          current_status: string | null;
          duty_record_id: string | null;
          time_in: string | null;
          time_out: string | null;
          duty_date: string | null;
        };
        Relationships: [];
      };
      monthly_duty_stats: {
        Row: {
          officer_id: string | null;
          name: string | null;
          rank: string | null;
          unit: string | null;
          month: string | null;
          days_on_duty: number | null;
          total_check_ins: number | null;
          total_hours: number | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      check_in_officer: {
        Args: {
          p_officer_id: string;
          p_notes?: string;
        };
        Returns: string;
      };
      check_out_officer: {
        Args: {
          p_officer_id: string;
        };
        Returns: undefined;
      };
      search_officers: {
        Args: {
          p_search_term: string;
        };
        Returns: {
          id: string;
          name: string;
          rank: string;
          badge_number: string;
          unit: string;
          current_status: string;
        }[];
      };
      get_officers_on_duty: {
        Args: {
          p_date?: string;
        };
        Returns: {
          officer_id: string;
          name: string;
          rank: string;
          badge_number: string;
          unit: string;
          time_in: string;
          time_out: string;
        }[];
      };
      get_duty_stats: {
        Args: {
          p_start_date: string;
          p_end_date: string;
        };
        Returns: {
          duty_date: string;
          total_officers: number;
          officers_on_duty: number;
          officers_off_duty: number;
        }[];
      };
      update_updated_at_column: {
        Args: Record<PropertyKey, never>;
        Returns: unknown;
      };
      update_officer_status: {
        Args: Record<PropertyKey, never>;
        Returns: unknown;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
}

// Type aliases for convenience
export type Officer = Database['public']['Tables']['officers']['Row'];
export type OfficerInsert = Database['public']['Tables']['officers']['Insert'];
export type OfficerUpdate = Database['public']['Tables']['officers']['Update'];

export type DutyRecord = Database['public']['Tables']['duty_records']['Row'];
export type DutyRecordInsert = Database['public']['Tables']['duty_records']['Insert'];
export type DutyRecordUpdate = Database['public']['Tables']['duty_records']['Update'];

export type ScheduledTaskDB = Database['public']['Tables']['scheduled_tasks']['Row'];
export type ScheduledTaskInsert = Database['public']['Tables']['scheduled_tasks']['Insert'];
export type ScheduledTaskUpdate = Database['public']['Tables']['scheduled_tasks']['Update'];

export type TodayDutySummary = Database['public']['Views']['today_duty_summary']['Row'];
export type MonthlyDutyStats = Database['public']['Views']['monthly_duty_stats']['Row'];
