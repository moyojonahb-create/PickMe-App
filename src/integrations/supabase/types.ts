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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      admin_earnings: {
        Row: {
          created_at: string
          driver_earnings: number
          driver_id: string
          fare_amount: number
          id: string
          platform_fee: number
          ride_id: string | null
        }
        Insert: {
          created_at?: string
          driver_earnings: number
          driver_id: string
          fare_amount: number
          id?: string
          platform_fee: number
          ride_id?: string | null
        }
        Update: {
          created_at?: string
          driver_earnings?: number
          driver_id?: string
          fare_amount?: number
          id?: string
          platform_fee?: number
          ride_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_earnings_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "pending_rides_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_earnings_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "rides"
            referencedColumns: ["id"]
          },
        ]
      }
      call_sessions: {
        Row: {
          callee_id: string
          caller_id: string
          created_at: string
          ended_at: string | null
          id: string
          ride_id: string | null
          started_at: string | null
          status: string
        }
        Insert: {
          callee_id: string
          caller_id: string
          created_at?: string
          ended_at?: string | null
          id?: string
          ride_id?: string | null
          started_at?: string | null
          status?: string
        }
        Update: {
          callee_id?: string
          caller_id?: string
          created_at?: string
          ended_at?: string | null
          id?: string
          ride_id?: string | null
          started_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_sessions_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "pending_rides_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_sessions_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "rides"
            referencedColumns: ["id"]
          },
        ]
      }
      cancellation_fees: {
        Row: {
          amount: number
          created_at: string
          id: string
          reason: string | null
          ride_id: string
          user_id: string
          waived: boolean
        }
        Insert: {
          amount?: number
          created_at?: string
          id?: string
          reason?: string | null
          ride_id: string
          user_id: string
          waived?: boolean
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          reason?: string | null
          ride_id?: string
          user_id?: string
          waived?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "cancellation_fees_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "pending_rides_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cancellation_fees_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "rides"
            referencedColumns: ["id"]
          },
        ]
      }
      deposit_requests: {
        Row: {
          admin_note: string | null
          amount_usd: number
          approved_at: string | null
          approved_by: string | null
          created_at: string
          driver_id: string
          ecocash_phone: string
          ecocash_reference: string
          id: string
          proof_path: string | null
          status: string
        }
        Insert: {
          admin_note?: string | null
          amount_usd: number
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          driver_id: string
          ecocash_phone: string
          ecocash_reference: string
          id?: string
          proof_path?: string | null
          status?: string
        }
        Update: {
          admin_note?: string | null
          amount_usd?: number
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          driver_id?: string
          ecocash_phone?: string
          ecocash_reference?: string
          id?: string
          proof_path?: string | null
          status?: string
        }
        Relationships: []
      }
      disputes: {
        Row: {
          admin_response: string | null
          category: string
          created_at: string
          description: string
          id: string
          reporter_id: string
          reporter_role: string
          resolved_at: string | null
          resolved_by: string | null
          ride_id: string
          status: string
          updated_at: string
        }
        Insert: {
          admin_response?: string | null
          category?: string
          created_at?: string
          description: string
          id?: string
          reporter_id: string
          reporter_role?: string
          resolved_at?: string | null
          resolved_by?: string | null
          ride_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          admin_response?: string | null
          category?: string
          created_at?: string
          description?: string
          id?: string
          reporter_id?: string
          reporter_role?: string
          resolved_at?: string | null
          resolved_by?: string | null
          ride_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "disputes_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "pending_rides_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disputes_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "rides"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_documents: {
        Row: {
          created_at: string
          document_type: string
          driver_id: string
          file_url: string
          id: string
          rejection_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          document_type: string
          driver_id: string
          file_url: string
          id?: string
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          document_type?: string
          driver_id?: string
          file_url?: string
          id?: string
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_documents_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_feedback: {
        Row: {
          admin_response: string | null
          created_at: string
          driver_id: string
          id: string
          message: string
          status: string
          type: string
          updated_at: string
        }
        Insert: {
          admin_response?: string | null
          created_at?: string
          driver_id: string
          id?: string
          message: string
          status?: string
          type: string
          updated_at?: string
        }
        Update: {
          admin_response?: string | null
          created_at?: string
          driver_id?: string
          id?: string
          message?: string
          status?: string
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      driver_queue: {
        Row: {
          created_at: string
          driver_id: string
          id: string
          notified_at: string | null
          position: number
          responded_at: string | null
          response: string | null
          ride_id: string
          status: string
        }
        Insert: {
          created_at?: string
          driver_id: string
          id?: string
          notified_at?: string | null
          position?: number
          responded_at?: string | null
          response?: string | null
          ride_id: string
          status?: string
        }
        Update: {
          created_at?: string
          driver_id?: string
          id?: string
          notified_at?: string | null
          position?: number
          responded_at?: string | null
          response?: string | null
          ride_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_queue_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_queue_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "pending_rides_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_queue_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "rides"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_ratings: {
        Row: {
          comment: string | null
          created_at: string
          driver_id: string
          id: string
          rating: number
          ride_id: string
          rider_id: string
        }
        Insert: {
          comment?: string | null
          created_at?: string
          driver_id: string
          id?: string
          rating: number
          ride_id: string
          rider_id: string
        }
        Update: {
          comment?: string | null
          created_at?: string
          driver_id?: string
          id?: string
          rating?: number
          ride_id?: string
          rider_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_ratings_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_ratings_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "pending_rides_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_ratings_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "rides"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_sessions: {
        Row: {
          created_at: string
          driver_id: string
          forced_break_until: string | null
          id: string
          went_offline_at: string | null
          went_online_at: string
        }
        Insert: {
          created_at?: string
          driver_id: string
          forced_break_until?: string | null
          id?: string
          went_offline_at?: string | null
          went_online_at?: string
        }
        Update: {
          created_at?: string
          driver_id?: string
          forced_break_until?: string | null
          id?: string
          went_offline_at?: string | null
          went_online_at?: string
        }
        Relationships: []
      }
      driver_wallets: {
        Row: {
          balance_usd: number
          created_at: string
          driver_id: string
          id: string
          updated_at: string
        }
        Insert: {
          balance_usd?: number
          created_at?: string
          driver_id: string
          id?: string
          updated_at?: string
        }
        Update: {
          balance_usd?: number
          created_at?: string
          driver_id?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      drivers: {
        Row: {
          avatar_url: string | null
          created_at: string
          earning_notifications: boolean
          ecocash_number: string | null
          gender: string | null
          id: string
          is_hearing_impaired: boolean
          is_online: boolean | null
          is_wav: boolean
          plate_number: string | null
          preferred_service_area: string
          rating_avg: number | null
          status: string
          total_trips: number | null
          trial_ends_at: string | null
          updated_at: string
          user_id: string
          vehicle_color: string | null
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_type: string
          vehicle_year: number | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          earning_notifications?: boolean
          ecocash_number?: string | null
          gender?: string | null
          id?: string
          is_hearing_impaired?: boolean
          is_online?: boolean | null
          is_wav?: boolean
          plate_number?: string | null
          preferred_service_area?: string
          rating_avg?: number | null
          status?: string
          total_trips?: number | null
          trial_ends_at?: string | null
          updated_at?: string
          user_id: string
          vehicle_color?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_type?: string
          vehicle_year?: number | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          earning_notifications?: boolean
          ecocash_number?: string | null
          gender?: string | null
          id?: string
          is_hearing_impaired?: boolean
          is_online?: boolean | null
          is_wav?: boolean
          plate_number?: string | null
          preferred_service_area?: string
          rating_avg?: number | null
          status?: string
          total_trips?: number | null
          trial_ends_at?: string | null
          updated_at?: string
          user_id?: string
          vehicle_color?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_type?: string
          vehicle_year?: number | null
        }
        Relationships: []
      }
      eco_stats: {
        Row: {
          id: string
          shared_rides_count: number
          total_co2_saved_kg: number
          updated_at: string
          user_id: string
        }
        Insert: {
          id?: string
          shared_rides_count?: number
          total_co2_saved_kg?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          id?: string
          shared_rides_count?: number
          total_co2_saved_kg?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      emergency_alerts: {
        Row: {
          created_at: string
          id: string
          latitude: number
          longitude: number
          resolved: boolean
          resolved_at: string | null
          resolved_by: string | null
          ride_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          latitude: number
          longitude: number
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          ride_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          latitude?: number
          longitude?: number
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          ride_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "emergency_alerts_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "pending_rides_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emergency_alerts_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "rides"
            referencedColumns: ["id"]
          },
        ]
      }
      favorite_locations: {
        Row: {
          address: string
          created_at: string
          icon: string | null
          id: string
          latitude: number
          longitude: number
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          address: string
          created_at?: string
          icon?: string | null
          id?: string
          latitude: number
          longitude: number
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          address?: string
          created_at?: string
          icon?: string | null
          id?: string
          latitude?: number
          longitude?: number
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      fraud_flags: {
        Row: {
          created_at: string
          details: Json | null
          flag_type: string
          id: string
          resolved: boolean
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          user_id: string
        }
        Insert: {
          created_at?: string
          details?: Json | null
          flag_type: string
          id?: string
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          user_id: string
        }
        Update: {
          created_at?: string
          details?: Json | null
          flag_type?: string
          id?: string
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          user_id?: string
        }
        Relationships: []
      }
      fx_rates: {
        Row: {
          created_at: string
          effective_date: string
          id: string
          set_by: string | null
          zar_per_usd: number
        }
        Insert: {
          created_at?: string
          effective_date?: string
          id?: string
          set_by?: string | null
          zar_per_usd: number
        }
        Update: {
          created_at?: string
          effective_date?: string
          id?: string
          set_by?: string | null
          zar_per_usd?: number
        }
        Relationships: []
      }
      gender_change_log: {
        Row: {
          created_at: string
          id: string
          new_gender: string
          old_gender: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          new_gender: string
          old_gender?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          new_gender?: string
          old_gender?: string | null
          user_id?: string
        }
        Relationships: []
      }
      institutions: {
        Row: {
          city: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          type: string
        }
        Insert: {
          city: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          type: string
        }
        Update: {
          city?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          type?: string
        }
        Relationships: []
      }
      koloi_landmarks: {
        Row: {
          category: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          keywords: string[] | null
          latitude: number
          longitude: number
          name: string
          updated_at: string
        }
        Insert: {
          category: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          keywords?: string[] | null
          latitude: number
          longitude: number
          name: string
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          keywords?: string[] | null
          latitude?: number
          longitude?: number
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      live_locations: {
        Row: {
          accuracy: number | null
          heading: number | null
          id: string
          is_online: boolean | null
          latitude: number
          longitude: number
          speed: number | null
          updated_at: string
          user_id: string
          user_type: string
        }
        Insert: {
          accuracy?: number | null
          heading?: number | null
          id?: string
          is_online?: boolean | null
          latitude: number
          longitude: number
          speed?: number | null
          updated_at?: string
          user_id: string
          user_type: string
        }
        Update: {
          accuracy?: number | null
          heading?: number | null
          id?: string
          is_online?: boolean | null
          latitude?: number
          longitude?: number
          speed?: number | null
          updated_at?: string
          user_id?: string
          user_type?: string
        }
        Relationships: []
      }
      messages: {
        Row: {
          created_at: string
          id: string
          ride_id: string
          sender_id: string
          text: string
        }
        Insert: {
          created_at?: string
          id?: string
          ride_id: string
          sender_id: string
          text: string
        }
        Update: {
          created_at?: string
          id?: string
          ride_id?: string
          sender_id?: string
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "pending_rides_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "rides"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string
          created_at: string
          id: string
          is_read: boolean | null
          notification_type: string
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          is_read?: boolean | null
          notification_type: string
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          is_read?: boolean | null
          notification_type?: string
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      offers: {
        Row: {
          counter_offer: number | null
          created_at: string
          driver_id: string
          eta_minutes: number | null
          id: string
          message: string | null
          price: number
          ride_id: string
          status: string
        }
        Insert: {
          counter_offer?: number | null
          created_at?: string
          driver_id: string
          eta_minutes?: number | null
          id?: string
          message?: string | null
          price: number
          ride_id: string
          status?: string
        }
        Update: {
          counter_offer?: number | null
          created_at?: string
          driver_id?: string
          eta_minutes?: number | null
          id?: string
          message?: string | null
          price?: number
          ride_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "offers_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "pending_rides_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offers_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "rides"
            referencedColumns: ["id"]
          },
        ]
      }
      phone_verifications: {
        Row: {
          attempts: number
          created_at: string
          expires_at: string
          id: string
          otp_hash: string
          phone_number: string
          verified: boolean
        }
        Insert: {
          attempts?: number
          created_at?: string
          expires_at: string
          id?: string
          otp_hash: string
          phone_number: string
          verified?: boolean
        }
        Update: {
          attempts?: number
          created_at?: string
          expires_at?: string
          id?: string
          otp_hash?: string
          phone_number?: string
          verified?: boolean
        }
        Relationships: []
      }
      places_cache: {
        Row: {
          address: Json | null
          class: string | null
          created_at: string
          display_name: string
          id: string
          lat: number
          lon: number
          name: string | null
          osm_id: number | null
          osm_type: string | null
          type: string | null
        }
        Insert: {
          address?: Json | null
          class?: string | null
          created_at?: string
          display_name: string
          id?: string
          lat: number
          lon: number
          name?: string | null
          osm_id?: number | null
          osm_type?: string | null
          type?: string | null
        }
        Update: {
          address?: Json | null
          class?: string | null
          created_at?: string
          display_name?: string
          id?: string
          lat?: number
          lon?: number
          name?: string | null
          osm_id?: number | null
          osm_type?: string | null
          type?: string | null
        }
        Relationships: []
      }
      platform_ledger: {
        Row: {
          amount: number
          created_at: string
          currency: string
          driver_id: string | null
          id: string
          passenger_id: string | null
          status: string
          to_account_id: string
          trip_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          driver_id?: string | null
          id?: string
          passenger_id?: string | null
          status?: string
          to_account_id?: string
          trip_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          driver_id?: string | null
          id?: string
          passenger_id?: string | null
          status?: string
          to_account_id?: string
          trip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_ledger_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: true
            referencedRelation: "pending_rides_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_ledger_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: true
            referencedRelation: "rides"
            referencedColumns: ["id"]
          },
        ]
      }
      pricing_settings: {
        Row: {
          base_fare: number
          fixed_town_fare: number
          gwanda_cbd_lat: number
          gwanda_cbd_lng: number
          id: string
          max_town_fare: number
          min_fare: number
          night_multiplier: number
          peak_multiplier: number
          per_km_rate: number
          town_radius_km: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          base_fare?: number
          fixed_town_fare?: number
          gwanda_cbd_lat?: number
          gwanda_cbd_lng?: number
          id?: string
          max_town_fare?: number
          min_fare?: number
          night_multiplier?: number
          peak_multiplier?: number
          per_km_rate?: number
          town_radius_km?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          base_fare?: number
          fixed_town_fare?: number
          gwanda_cbd_lat?: number
          gwanda_cbd_lng?: number
          id?: string
          max_town_fare?: number
          min_fare?: number
          night_multiplier?: number
          peak_multiplier?: number
          per_km_rate?: number
          town_radius_km?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          cool_temperature: boolean
          created_at: string
          full_name: string | null
          gender: string | null
          gender_preference: string
          hearing_impaired: boolean
          id: string
          phone: string | null
          pickme_account: string | null
          quiet_ride: boolean
          referral_code: string | null
          updated_at: string
          user_id: string
          wav_required: boolean
        }
        Insert: {
          avatar_url?: string | null
          cool_temperature?: boolean
          created_at?: string
          full_name?: string | null
          gender?: string | null
          gender_preference?: string
          hearing_impaired?: boolean
          id?: string
          phone?: string | null
          pickme_account?: string | null
          quiet_ride?: boolean
          referral_code?: string | null
          updated_at?: string
          user_id: string
          wav_required?: boolean
        }
        Update: {
          avatar_url?: string | null
          cool_temperature?: boolean
          created_at?: string
          full_name?: string | null
          gender?: string | null
          gender_preference?: string
          hearing_impaired?: boolean
          id?: string
          phone?: string | null
          pickme_account?: string | null
          quiet_ride?: boolean
          referral_code?: string | null
          updated_at?: string
          user_id?: string
          wav_required?: boolean
        }
        Relationships: []
      }
      promo_codes: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          current_uses: number
          discount_type: string
          discount_value: number
          expires_at: string | null
          id: string
          is_active: boolean
          max_uses: number | null
          min_fare: number | null
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          current_uses?: number
          discount_type?: string
          discount_value?: number
          expires_at?: string | null
          id?: string
          is_active?: boolean
          max_uses?: number | null
          min_fare?: number | null
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          current_uses?: number
          discount_type?: string
          discount_value?: number
          expires_at?: string | null
          id?: string
          is_active?: boolean
          max_uses?: number | null
          min_fare?: number | null
        }
        Relationships: []
      }
      promo_usage: {
        Row: {
          created_at: string
          discount_amount: number
          id: string
          promo_id: string
          ride_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          discount_amount: number
          id?: string
          promo_id: string
          ride_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          discount_amount?: number
          id?: string
          promo_id?: string
          ride_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "promo_usage_promo_id_fkey"
            columns: ["promo_id"]
            isOneToOne: false
            referencedRelation: "promo_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promo_usage_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "pending_rides_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promo_usage_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "rides"
            referencedColumns: ["id"]
          },
        ]
      }
      ramz_patch_audit: {
        Row: {
          action: string
          admin_id: string
          ai_summary: string | null
          created_at: string
          file_path: string
          finding_category: string
          finding_line: number | null
          finding_severity: string
          finding_title: string
          id: string
          original_content: string | null
          patched_content: string | null
          verification_findings: Json | null
          verification_status: string | null
        }
        Insert: {
          action: string
          admin_id: string
          ai_summary?: string | null
          created_at?: string
          file_path: string
          finding_category: string
          finding_line?: number | null
          finding_severity: string
          finding_title: string
          id?: string
          original_content?: string | null
          patched_content?: string | null
          verification_findings?: Json | null
          verification_status?: string | null
        }
        Update: {
          action?: string
          admin_id?: string
          ai_summary?: string | null
          created_at?: string
          file_path?: string
          finding_category?: string
          finding_line?: number | null
          finding_severity?: string
          finding_title?: string
          id?: string
          original_content?: string | null
          patched_content?: string | null
          verification_findings?: Json | null
          verification_status?: string | null
        }
        Relationships: []
      }
      referrals: {
        Row: {
          bonus_amount: number
          completed_at: string | null
          created_at: string
          id: string
          referral_code: string
          referred_id: string
          referrer_id: string
          status: string
        }
        Insert: {
          bonus_amount?: number
          completed_at?: string | null
          created_at?: string
          id?: string
          referral_code: string
          referred_id: string
          referrer_id: string
          status?: string
        }
        Update: {
          bonus_amount?: number
          completed_at?: string | null
          created_at?: string
          id?: string
          referral_code?: string
          referred_id?: string
          referrer_id?: string
          status?: string
        }
        Relationships: []
      }
      request_throttle: {
        Row: {
          action: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      ride_demand_zones: {
        Row: {
          demand_score: number
          id: string
          latitude: number
          longitude: number
          ride_count: number
          time_bucket: string
          town_id: string
          updated_at: string
        }
        Insert: {
          demand_score?: number
          id?: string
          latitude: number
          longitude: number
          ride_count?: number
          time_bucket?: string
          town_id: string
          updated_at?: string
        }
        Update: {
          demand_score?: number
          id?: string
          latitude?: number
          longitude?: number
          ride_count?: number
          time_bucket?: string
          town_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      ride_offers: {
        Row: {
          created_at: string
          driver_id: string
          id: string
          offer_fare: number
          request_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          driver_id: string
          id?: string
          offer_fare: number
          request_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          driver_id?: string
          id?: string
          offer_fare?: number
          request_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ride_offers_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "ride_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      ride_preferences: {
        Row: {
          cool_temperature: boolean
          created_at: string
          gender_preference: string
          hearing_impaired: boolean
          id: string
          quiet_ride: boolean
          ride_id: string
          wav_required: boolean
        }
        Insert: {
          cool_temperature?: boolean
          created_at?: string
          gender_preference?: string
          hearing_impaired?: boolean
          id?: string
          quiet_ride?: boolean
          ride_id: string
          wav_required?: boolean
        }
        Update: {
          cool_temperature?: boolean
          created_at?: string
          gender_preference?: string
          hearing_impaired?: boolean
          id?: string
          quiet_ride?: boolean
          ride_id?: string
          wav_required?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "ride_preferences_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: true
            referencedRelation: "pending_rides_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ride_preferences_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: true
            referencedRelation: "rides"
            referencedColumns: ["id"]
          },
        ]
      }
      ride_requests: {
        Row: {
          created_at: string
          currency: string
          dropoff: string
          id: string
          offered_fare: number
          pickup: string
          rider_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          dropoff: string
          id?: string
          offered_fare: number
          pickup: string
          rider_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          dropoff?: string
          id?: string
          offered_fare?: number
          pickup?: string
          rider_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      ride_stops: {
        Row: {
          address: string
          arrived_at: string | null
          created_at: string
          id: string
          latitude: number
          longitude: number
          ride_id: string
          stop_order: number
        }
        Insert: {
          address: string
          arrived_at?: string | null
          created_at?: string
          id?: string
          latitude: number
          longitude: number
          ride_id: string
          stop_order?: number
        }
        Update: {
          address?: string
          arrived_at?: string | null
          created_at?: string
          id?: string
          latitude?: number
          longitude?: number
          ride_id?: string
          stop_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "ride_stops_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "pending_rides_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ride_stops_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "rides"
            referencedColumns: ["id"]
          },
        ]
      }
      rider_deposit_requests: {
        Row: {
          admin_note: string | null
          amount_usd: number
          approved_at: string | null
          approved_by: string | null
          created_at: string
          id: string
          payment_method: string
          phone_number: string
          proof_path: string | null
          reference: string
          status: string
          user_id: string
        }
        Insert: {
          admin_note?: string | null
          amount_usd: number
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          id?: string
          payment_method?: string
          phone_number: string
          proof_path?: string | null
          reference: string
          status?: string
          user_id: string
        }
        Update: {
          admin_note?: string | null
          amount_usd?: number
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          id?: string
          payment_method?: string
          phone_number?: string
          proof_path?: string | null
          reference?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      rides: {
        Row: {
          cancellation_fee: number | null
          created_at: string
          distance_km: number
          driver_id: string | null
          dropoff_address: string
          dropoff_lat: number
          dropoff_lon: number
          duration_minutes: number
          expires_at: string | null
          fare: number
          gender_preference: string | null
          id: string
          locked_price: number | null
          passenger_count: number
          passenger_name: string | null
          passenger_phone: string | null
          payment_failed: boolean
          payment_failure_reason: string | null
          payment_method: string
          pickup_address: string
          pickup_lat: number
          pickup_lon: number
          route_polyline: string | null
          scheduled_at: string | null
          status: string
          town_id: string | null
          updated_at: string
          user_id: string
          vehicle_type: string
          wallet_paid: boolean
          wallet_paid_at: string | null
        }
        Insert: {
          cancellation_fee?: number | null
          created_at?: string
          distance_km: number
          driver_id?: string | null
          dropoff_address: string
          dropoff_lat: number
          dropoff_lon: number
          duration_minutes: number
          expires_at?: string | null
          fare: number
          gender_preference?: string | null
          id?: string
          locked_price?: number | null
          passenger_count?: number
          passenger_name?: string | null
          passenger_phone?: string | null
          payment_failed?: boolean
          payment_failure_reason?: string | null
          payment_method?: string
          pickup_address: string
          pickup_lat: number
          pickup_lon: number
          route_polyline?: string | null
          scheduled_at?: string | null
          status?: string
          town_id?: string | null
          updated_at?: string
          user_id: string
          vehicle_type?: string
          wallet_paid?: boolean
          wallet_paid_at?: string | null
        }
        Update: {
          cancellation_fee?: number | null
          created_at?: string
          distance_km?: number
          driver_id?: string | null
          dropoff_address?: string
          dropoff_lat?: number
          dropoff_lon?: number
          duration_minutes?: number
          expires_at?: string | null
          fare?: number
          gender_preference?: string | null
          id?: string
          locked_price?: number | null
          passenger_count?: number
          passenger_name?: string | null
          passenger_phone?: string | null
          payment_failed?: boolean
          payment_failure_reason?: string | null
          payment_method?: string
          pickup_address?: string
          pickup_lat?: number
          pickup_lon?: number
          route_polyline?: string | null
          scheduled_at?: string | null
          status?: string
          town_id?: string | null
          updated_at?: string
          user_id?: string
          vehicle_type?: string
          wallet_paid?: boolean
          wallet_paid_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rides_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_items: {
        Row: {
          content: string | null
          created_at: string | null
          id: string
          title: string
          user_id: string
        }
        Insert: {
          content?: string | null
          created_at?: string | null
          id?: string
          title: string
          user_id: string
        }
        Update: {
          content?: string | null
          created_at?: string | null
          id?: string
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      student_discount_usage: {
        Row: {
          created_at: string
          discount_amount: number
          id: string
          ride_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          discount_amount?: number
          id?: string
          ride_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          discount_amount?: number
          id?: string
          ride_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      student_profiles: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          attempt_count: number
          created_at: string
          device_id: string | null
          face_match_score: number | null
          fraud_score: number
          id: string
          id_photo_path: string | null
          id_photo_quality: Json | null
          institution_id: string
          national_id_number: string
          registration_number: string
          rejection_reason: string | null
          selfie_photo_path: string | null
          selfie_photo_quality: Json | null
          student_mode_active: boolean
          updated_at: string
          user_id: string
          verification_status: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          attempt_count?: number
          created_at?: string
          device_id?: string | null
          face_match_score?: number | null
          fraud_score?: number
          id?: string
          id_photo_path?: string | null
          id_photo_quality?: Json | null
          institution_id: string
          national_id_number: string
          registration_number: string
          rejection_reason?: string | null
          selfie_photo_path?: string | null
          selfie_photo_quality?: Json | null
          student_mode_active?: boolean
          updated_at?: string
          user_id: string
          verification_status?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          attempt_count?: number
          created_at?: string
          device_id?: string | null
          face_match_score?: number | null
          fraud_score?: number
          id?: string
          id_photo_path?: string | null
          id_photo_quality?: Json | null
          institution_id?: string
          national_id_number?: string
          registration_number?: string
          rejection_reason?: string | null
          selfie_photo_path?: string | null
          selfie_photo_quality?: Json | null
          student_mode_active?: boolean
          updated_at?: string
          user_id?: string
          verification_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_profiles_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      student_verification_attempts: {
        Row: {
          blur: number | null
          brightness: number | null
          created_at: string
          face_match_score: number | null
          glare: boolean | null
          height: number | null
          id: string
          notes: string | null
          photo_kind: string
          rejected_step: string | null
          student_profile_id: string | null
          user_id: string
          verification_status: string | null
          width: number | null
        }
        Insert: {
          blur?: number | null
          brightness?: number | null
          created_at?: string
          face_match_score?: number | null
          glare?: boolean | null
          height?: number | null
          id?: string
          notes?: string | null
          photo_kind: string
          rejected_step?: string | null
          student_profile_id?: string | null
          user_id: string
          verification_status?: string | null
          width?: number | null
        }
        Update: {
          blur?: number | null
          brightness?: number | null
          created_at?: string
          face_match_score?: number | null
          glare?: boolean | null
          height?: number | null
          id?: string
          notes?: string | null
          photo_kind?: string
          rejected_step?: string | null
          student_profile_id?: string | null
          user_id?: string
          verification_status?: string | null
          width?: number | null
        }
        Relationships: []
      }
      system_error_logs: {
        Row: {
          affected_users: number | null
          context: string | null
          created_at: string
          description: string
          error_type: string
          id: string
          period: string
          resolved: boolean
          resolved_at: string | null
          resolved_by: string | null
          scan_id: string | null
          severity: string
          suggestion: string | null
          title: string
          updated_at: string
        }
        Insert: {
          affected_users?: number | null
          context?: string | null
          created_at?: string
          description: string
          error_type?: string
          id?: string
          period?: string
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          scan_id?: string | null
          severity?: string
          suggestion?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          affected_users?: number | null
          context?: string | null
          created_at?: string
          description?: string
          error_type?: string
          id?: string
          period?: string
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          scan_id?: string | null
          severity?: string
          suggestion?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      system_events: {
        Row: {
          actor_id: string | null
          created_at: string
          details: Json | null
          entity_id: string | null
          entity_type: string | null
          event_type: string
          id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string | null
          event_type: string
          id?: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string | null
          event_type?: string
          id?: string
        }
        Relationships: []
      }
      tips: {
        Row: {
          amount: number
          created_at: string
          driver_id: string
          id: string
          ride_id: string | null
          rider_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          driver_id: string
          id?: string
          ride_id?: string | null
          rider_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          driver_id?: string
          id?: string
          ride_id?: string | null
          rider_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tips_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "pending_rides_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tips_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "rides"
            referencedColumns: ["id"]
          },
        ]
      }
      town_pricing: {
        Row: {
          base_fare: number
          created_at: string
          currency_code: string
          currency_symbol: string
          demand_multiplier: number
          id: string
          is_negotiation_enabled: boolean
          minimum_fare: number
          night_multiplier: number
          offer_ceiling: number
          offer_floor: number
          per_km_rate: number
          short_trip_fare: number
          short_trip_km: number
          town_id: string
          town_name: string
          updated_at: string
        }
        Insert: {
          base_fare?: number
          created_at?: string
          currency_code?: string
          currency_symbol?: string
          demand_multiplier?: number
          id?: string
          is_negotiation_enabled?: boolean
          minimum_fare?: number
          night_multiplier?: number
          offer_ceiling?: number
          offer_floor?: number
          per_km_rate?: number
          short_trip_fare?: number
          short_trip_km?: number
          town_id: string
          town_name: string
          updated_at?: string
        }
        Update: {
          base_fare?: number
          created_at?: string
          currency_code?: string
          currency_symbol?: string
          demand_multiplier?: number
          id?: string
          is_negotiation_enabled?: boolean
          minimum_fare?: number
          night_multiplier?: number
          offer_ceiling?: number
          offer_floor?: number
          per_km_rate?: number
          short_trip_fare?: number
          short_trip_km?: number
          town_id?: string
          town_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      trip_events: {
        Row: {
          actor_id: string | null
          created_at: string
          event_type: string
          id: string
          payload: Json | null
          ride_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          payload?: Json | null
          ride_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          payload?: Json | null
          ride_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_events_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "pending_rides_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_events_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "rides"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_settings: {
        Row: {
          created_at: string
          id: string
          notifications_enabled: boolean
          promo_notifications: boolean
          ride_update_notifications: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          notifications_enabled?: boolean
          promo_notifications?: boolean
          ride_update_notifications?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          notifications_enabled?: boolean
          promo_notifications?: boolean
          ride_update_notifications?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      wallet_pins: {
        Row: {
          created_at: string
          pin_hash: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          pin_hash: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          pin_hash?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      wallet_transactions: {
        Row: {
          amount: number
          created_at: string
          description: string | null
          id: string
          reference_code: string | null
          ride_id: string | null
          transaction_type: string
          user_id: string
          wallet_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          description?: string | null
          id?: string
          reference_code?: string | null
          ride_id?: string | null
          transaction_type: string
          user_id: string
          wallet_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string | null
          id?: string
          reference_code?: string | null
          ride_id?: string | null
          transaction_type?: string
          user_id?: string
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wallet_transactions_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "pending_rides_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallet_transactions_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "rides"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallet_transactions_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallet_transactions_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      wallet_transfers: {
        Row: {
          amount_usd: number
          created_at: string
          id: string
          note: string | null
          receiver_id: string
          sender_id: string
          status: string
        }
        Insert: {
          amount_usd: number
          created_at?: string
          id?: string
          note?: string | null
          receiver_id: string
          sender_id: string
          status?: string
        }
        Update: {
          amount_usd?: number
          created_at?: string
          id?: string
          note?: string | null
          receiver_id?: string
          sender_id?: string
          status?: string
        }
        Relationships: []
      }
      wallets: {
        Row: {
          balance: number
          created_at: string
          id: string
          is_locked: boolean
          locked_at: string | null
          locked_by: string | null
          locked_reason: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          balance?: number
          created_at?: string
          id?: string
          is_locked?: boolean
          locked_at?: string | null
          locked_by?: string | null
          locked_reason?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          balance?: number
          created_at?: string
          id?: string
          is_locked?: boolean
          locked_at?: string | null
          locked_by?: string | null
          locked_reason?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      withdrawals: {
        Row: {
          account_name: string | null
          admin_note: string | null
          amount_usd: number
          approved_at: string | null
          approved_by: string | null
          created_at: string
          destination: string
          driver_id: string
          id: string
          method: string
          status: string
        }
        Insert: {
          account_name?: string | null
          admin_note?: string | null
          amount_usd: number
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          destination: string
          driver_id: string
          id?: string
          method: string
          status?: string
        }
        Update: {
          account_name?: string | null
          admin_note?: string | null
          amount_usd?: number
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          destination?: string
          driver_id?: string
          id?: string
          method?: string
          status?: string
        }
        Relationships: []
      }
    }
    Views: {
      pending_rides_safe: {
        Row: {
          created_at: string | null
          distance_km: number | null
          driver_id: string | null
          dropoff_address: string | null
          dropoff_lat: number | null
          dropoff_lon: number | null
          duration_minutes: number | null
          fare: number | null
          gender_preference: string | null
          id: string | null
          passenger_count: number | null
          payment_method: string | null
          pickup_address: string | null
          pickup_lat: number | null
          pickup_lon: number | null
          route_polyline: string | null
          scheduled_at: string | null
          status: string | null
          town_id: string | null
          user_id: string | null
          vehicle_type: string | null
        }
        Insert: {
          created_at?: string | null
          distance_km?: number | null
          driver_id?: string | null
          dropoff_address?: string | null
          dropoff_lat?: number | null
          dropoff_lon?: number | null
          duration_minutes?: number | null
          fare?: number | null
          gender_preference?: string | null
          id?: string | null
          passenger_count?: number | null
          payment_method?: string | null
          pickup_address?: string | null
          pickup_lat?: number | null
          pickup_lon?: number | null
          route_polyline?: string | null
          scheduled_at?: string | null
          status?: string | null
          town_id?: string | null
          user_id?: string | null
          vehicle_type?: string | null
        }
        Update: {
          created_at?: string | null
          distance_km?: number | null
          driver_id?: string | null
          dropoff_address?: string | null
          dropoff_lat?: number | null
          dropoff_lon?: number | null
          duration_minutes?: number | null
          fare?: number | null
          gender_preference?: string | null
          id?: string | null
          passenger_count?: number | null
          payment_method?: string | null
          pickup_address?: string | null
          pickup_lat?: number | null
          pickup_lon?: number | null
          route_polyline?: string | null
          scheduled_at?: string | null
          status?: string | null
          town_id?: string | null
          user_id?: string | null
          vehicle_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rides_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      wallets_safe: {
        Row: {
          balance: number | null
          created_at: string | null
          id: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          balance?: number | null
          created_at?: string | null
          id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          balance?: number | null
          created_at?: string | null
          id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      admin_approve_deposit: {
        Args: { p_deposit_id: string; p_note?: string }
        Returns: Json
      }
      admin_approve_rider_deposit: {
        Args: { p_deposit_id: string; p_note?: string }
        Returns: Json
      }
      admin_approve_withdrawal: {
        Args: { p_id: string; p_note?: string }
        Returns: Json
      }
      admin_flag_user: {
        Args: { p_reason: string; p_severity?: string; p_user_id: string }
        Returns: Json
      }
      admin_lock_wallet: {
        Args: { p_reason: string; p_user_id: string }
        Returns: Json
      }
      admin_reject_withdrawal: {
        Args: { p_id: string; p_note?: string }
        Returns: Json
      }
      admin_resolve_fraud_flag: { Args: { p_flag_id: string }; Returns: Json }
      admin_reverse_transaction: {
        Args: { p_reason: string; p_tx_id: string }
        Returns: Json
      }
      admin_set_fx_rate: { Args: { p_zar_per_usd: number }; Returns: Json }
      admin_unlock_wallet: { Args: { p_user_id: string }; Returns: Json }
      auto_resolve_noise_fraud_flags: { Args: never; Returns: number }
      can_change_gender: { Args: { p_user_id: string }; Returns: boolean }
      can_driver_operate: { Args: { p_driver_id: string }; Returns: boolean }
      can_use_student_discount: { Args: { _user_id: string }; Returns: boolean }
      check_rate_limit: {
        Args: {
          p_action: string
          p_max_requests?: number
          p_user_id: string
          p_window_seconds?: number
        }
        Returns: boolean
      }
      cleanup_old_messages: { Args: never; Returns: number }
      cleanup_throttle: { Args: never; Returns: undefined }
      complete_trip_and_charge_flat_r4: {
        Args: { p_trip_id: string }
        Returns: Json
      }
      complete_trip_with_commission: {
        Args: { p_trip_id: string }
        Returns: Json
      }
      dispatch_scheduled_rides: { Args: never; Returns: number }
      expire_old_rides: { Args: never; Returns: number }
      generate_pickme_account: { Args: never; Returns: string }
      get_driver_id: { Args: { _user_id: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_online_driver: { Args: { _user_id: string }; Returns: boolean }
      is_ride_driver: {
        Args: { _driver_id: string; _user_id: string }
        Returns: boolean
      }
      is_top_driver: { Args: { _user_id: string }; Returns: boolean }
      is_user_driver: { Args: { _user_id: string }; Returns: boolean }
      lookup_user_by_pickme_account: {
        Args: { p_account: string }
        Returns: {
          full_name: string
          pickme_account: string
          user_id: string
        }[]
      }
      pay_ride_from_wallet: { Args: { p_ride_id: string }; Returns: Json }
      request_wallet_ride: { Args: { p_payload: Json }; Returns: Json }
      request_withdrawal: {
        Args: {
          p_account_name?: string
          p_amount: number
          p_destination: string
          p_method: string
        }
        Returns: Json
      }
      transfer_funds: {
        Args: { p_amount: number; p_note?: string; p_receiver_id: string }
        Returns: Json
      }
      update_demand_zones: { Args: never; Returns: undefined }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
      app_role: ["admin", "moderator", "user"],
    },
  },
} as const
