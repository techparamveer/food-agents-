export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      api_cache: {
        Row: {
          created_at: string
          expires_at: string
          key: string
          value: Json
        }
        Insert: {
          created_at?: string
          expires_at: string
          key: string
          value: Json
        }
        Update: {
          created_at?: string
          expires_at?: string
          key?: string
          value?: Json
        }
        Relationships: []
      }
      attendees: {
        Row: {
          avatar_url: string | null
          created_at: string
          dietary: Database["public"]["Enums"]["dietary"] | null
          discord_handle: string | null
          email: string | null
          event_id: string
          id: string
          name: string
          qr_hash: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          dietary?: Database["public"]["Enums"]["dietary"] | null
          discord_handle?: string | null
          email?: string | null
          event_id: string
          id?: string
          name: string
          qr_hash?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          dietary?: Database["public"]["Enums"]["dietary"] | null
          discord_handle?: string | null
          email?: string | null
          event_id?: string
          id?: string
          name?: string
          qr_hash?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendees_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_members: {
        Row: {
          accepted_at: string | null
          created_at: string
          event_id: string
          id: string
          invited_by: string | null
          invited_email: string | null
          role: Database["public"]["Enums"]["event_role"]
          updated_at: string
          user_id: string | null
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          event_id: string
          id?: string
          invited_by?: string | null
          invited_email?: string | null
          role?: Database["public"]["Enums"]["event_role"]
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          event_id?: string
          id?: string
          invited_by?: string | null
          invited_email?: string | null
          role?: Database["public"]["Enums"]["event_role"]
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_members_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          budget: number
          created_at: string
          created_by: string | null
          currency: string
          dietary_mix: Json
          ends_at: string
          headcount: number
          id: string
          name: string
          starts_at: string
          timezone: string
          updated_at: string
          venue_address: string
          venue_lat: number
          venue_lng: number
          venue_name: string
          venue_postcode: string
        }
        Insert: {
          budget?: number
          created_at?: string
          created_by?: string | null
          currency?: string
          dietary_mix?: Json
          ends_at: string
          headcount: number
          id?: string
          name: string
          starts_at: string
          timezone?: string
          updated_at?: string
          venue_address?: string
          venue_lat: number
          venue_lng: number
          venue_name: string
          venue_postcode?: string
        }
        Update: {
          budget?: number
          created_at?: string
          created_by?: string | null
          currency?: string
          dietary_mix?: Json
          ends_at?: string
          headcount?: number
          id?: string
          name?: string
          starts_at?: string
          timezone?: string
          updated_at?: string
          venue_address?: string
          venue_lat?: number
          venue_lng?: number
          venue_name?: string
          venue_postcode?: string
        }
        Relationships: []
      }
      meal_logs: {
        Row: {
          attendee_id: string
          created_at: string
          event_id: string
          id: string
          method: Database["public"]["Enums"]["serve_method"]
          served_at: string
          served_by: string | null
          slot_id: string
          undone_at: string | null
          undone_by: string | null
        }
        Insert: {
          attendee_id: string
          created_at?: string
          event_id: string
          id?: string
          method?: Database["public"]["Enums"]["serve_method"]
          served_at?: string
          served_by?: string | null
          slot_id: string
          undone_at?: string | null
          undone_by?: string | null
        }
        Update: {
          attendee_id?: string
          created_at?: string
          event_id?: string
          id?: string
          method?: Database["public"]["Enums"]["serve_method"]
          served_at?: string
          served_by?: string | null
          slot_id?: string
          undone_at?: string | null
          undone_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meal_logs_attendee_fkey"
            columns: ["event_id", "attendee_id"]
            isOneToOne: false
            referencedRelation: "attendees"
            referencedColumns: ["event_id", "id"]
          },
          {
            foreignKeyName: "meal_logs_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meal_logs_slot_fkey"
            columns: ["event_id", "slot_id"]
            isOneToOne: false
            referencedRelation: "meal_slots"
            referencedColumns: ["event_id", "id"]
          },
        ]
      }
      meal_slots: {
        Row: {
          allowance: number
          closes_after_minutes: number
          created_at: string
          event_id: string
          headcount: number
          id: string
          kind: Database["public"]["Enums"]["meal_kind"]
          label: string
          opens_before_minutes: number
          seconds: number
          seconds_after_minutes: number | null
          serves_at: string
          updated_at: string
        }
        Insert: {
          allowance?: number
          closes_after_minutes?: number
          created_at?: string
          event_id: string
          headcount: number
          id?: string
          kind: Database["public"]["Enums"]["meal_kind"]
          label: string
          opens_before_minutes?: number
          seconds?: number
          seconds_after_minutes?: number | null
          serves_at: string
          updated_at?: string
        }
        Update: {
          allowance?: number
          closes_after_minutes?: number
          created_at?: string
          event_id?: string
          headcount?: number
          id?: string
          kind?: Database["public"]["Enums"]["meal_kind"]
          label?: string
          opens_before_minutes?: number
          seconds?: number
          seconds_after_minutes?: number | null
          serves_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meal_slots_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          created_at: string
          event_id: string
          id: string
          lines: Json
          order_by: string | null
          ordered_at: string | null
          plan_id: string | null
          platform: Database["public"]["Enums"]["delivery_platform"]
          restaurant: Json
          restaurant_id: string
          slot_id: string
          status: Database["public"]["Enums"]["order_status"]
          total: number
          total_is_estimate: boolean
          total_source: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          lines?: Json
          order_by?: string | null
          ordered_at?: string | null
          plan_id?: string | null
          platform?: Database["public"]["Enums"]["delivery_platform"]
          restaurant?: Json
          restaurant_id: string
          slot_id: string
          status?: Database["public"]["Enums"]["order_status"]
          total?: number
          total_is_estimate?: boolean
          total_source?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          lines?: Json
          order_by?: string | null
          ordered_at?: string | null
          plan_id?: string | null
          platform?: Database["public"]["Enums"]["delivery_platform"]
          restaurant?: Json
          restaurant_id?: string
          slot_id?: string
          status?: Database["public"]["Enums"]["order_status"]
          total?: number
          total_is_estimate?: boolean
          total_source?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_slot_fkey"
            columns: ["event_id", "slot_id"]
            isOneToOne: false
            referencedRelation: "meal_slots"
            referencedColumns: ["event_id", "id"]
          },
        ]
      }
      plans: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          event_id: string
          generated_at: string
          id: string
          slots: Json
          source: string
          status: Database["public"]["Enums"]["plan_status"]
          total: number
          total_source: Json
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          event_id: string
          generated_at?: string
          id?: string
          slots?: Json
          source?: string
          status?: Database["public"]["Enums"]["plan_status"]
          total?: number
          total_source?: Json
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          event_id?: string
          generated_at?: string
          id?: string
          slots?: Json
          source?: string
          status?: Database["public"]["Enums"]["plan_status"]
          total?: number
          total_source?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "plans_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_invites: { Args: never; Returns: number }
      import_attendees: {
        Args: { p_event_id: string; p_rows: Json }
        Returns: {
          attendee_id: string
          error: string
          row_index: number
        }[]
      }
      save_plan: { Args: { p_event_id: string; p_plan: Json }; Returns: Json }
      serve_meal: {
        Args: {
          p_attendee_id: string
          p_method?: Database["public"]["Enums"]["serve_method"]
          p_slot_id: string
        }
        Returns: Json
      }
      undo_meal: {
        Args: { p_log_id: string }
        Returns: {
          attendee_id: string
          created_at: string
          event_id: string
          id: string
          method: Database["public"]["Enums"]["serve_method"]
          served_at: string
          served_by: string | null
          slot_id: string
          undone_at: string | null
          undone_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "meal_logs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      delivery_platform: "deliveroo" | "ubereats" | "justeat" | "direct"
      dietary: "veg" | "vegan" | "halal" | "gf"
      event_role: "organiser" | "staff"
      meal_kind: "breakfast" | "lunch" | "dinner" | "snack"
      order_status: "planned" | "ordered" | "out_for_delivery" | "arrived"
      plan_status: "draft" | "approved"
      serve_method: "qr" | "search"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      delivery_platform: ["deliveroo", "ubereats", "justeat", "direct"],
      dietary: ["veg", "vegan", "halal", "gf"],
      event_role: ["organiser", "staff"],
      meal_kind: ["breakfast", "lunch", "dinner", "snack"],
      order_status: ["planned", "ordered", "out_for_delivery", "arrived"],
      plan_status: ["draft", "approved"],
      serve_method: ["qr", "search"],
    },
  },
} as const
