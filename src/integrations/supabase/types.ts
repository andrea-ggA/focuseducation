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
      achievements: {
        Row: {
          achievement_type: string
          earned_at: string
          id: string
          user_id: string
        }
        Insert: {
          achievement_type: string
          earned_at?: string
          id?: string
          user_id: string
        }
        Update: {
          achievement_type?: string
          earned_at?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      credit_transactions: {
        Row: {
          action: string
          amount: number
          created_at: string
          description: string | null
          id: string
          user_id: string
        }
        Insert: {
          action: string
          amount: number
          created_at?: string
          description?: string | null
          id?: string
          user_id: string
        }
        Update: {
          action?: string
          amount?: number
          created_at?: string
          description?: string | null
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      crisis_sessions: {
        Row: {
          activated_at: string
          completed_steps: number
          exam_subject: string | null
          expires_at: string
          hours_available: number
          id: string
          plan_content: Json
          total_steps: number
          user_id: string
        }
        Insert: {
          activated_at?: string
          completed_steps?: number
          exam_subject?: string | null
          expires_at?: string
          hours_available?: number
          id?: string
          plan_content?: Json
          total_steps?: number
          user_id: string
        }
        Update: {
          activated_at?: string
          completed_steps?: number
          exam_subject?: string | null
          expires_at?: string
          hours_available?: number
          id?: string
          plan_content?: Json
          total_steps?: number
          user_id?: string
        }
        Relationships: []
      }
      daily_objectives: {
        Row: {
          created_at: string
          focus_completed: number
          id: string
          objective_date: string
          questions_completed: number
          target_focus_minutes: number
          target_questions: number
          user_id: string
        }
        Insert: {
          created_at?: string
          focus_completed?: number
          id?: string
          objective_date?: string
          questions_completed?: number
          target_focus_minutes?: number
          target_questions?: number
          user_id: string
        }
        Update: {
          created_at?: string
          focus_completed?: number
          id?: string
          objective_date?: string
          questions_completed?: number
          target_focus_minutes?: number
          target_questions?: number
          user_id?: string
        }
        Relationships: []
      }
      documents: {
        Row: {
          created_at: string
          file_type: string | null
          file_url: string | null
          id: string
          status: string
          title: string
          user_id: string
        }
        Insert: {
          created_at?: string
          file_type?: string | null
          file_url?: string | null
          id?: string
          status?: string
          title: string
          user_id: string
        }
        Update: {
          created_at?: string
          file_type?: string | null
          file_url?: string | null
          id?: string
          status?: string
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      email_log: {
        Row: {
          email_type: string
          id: string
          sent_at: string
          user_id: string
        }
        Insert: {
          email_type: string
          id?: string
          sent_at?: string
          user_id: string
        }
        Update: {
          email_type?: string
          id?: string
          sent_at?: string
          user_id?: string
        }
        Relationships: []
      }
      flashcard_decks: {
        Row: {
          card_count: number
          created_at: string
          document_id: string | null
          id: string
          share_token: string | null
          title: string
          topic: string | null
          user_id: string
        }
        Insert: {
          card_count?: number
          created_at?: string
          document_id?: string | null
          id?: string
          share_token?: string | null
          title: string
          topic?: string | null
          user_id: string
        }
        Update: {
          card_count?: number
          created_at?: string
          document_id?: string | null
          id?: string
          share_token?: string | null
          title?: string
          topic?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "flashcard_decks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      flashcard_reviews: {
        Row: {
          card_id: string
          deck_id: string
          id: string
          quality: number
          reviewed_at: string
          user_id: string
        }
        Insert: {
          card_id: string
          deck_id: string
          id?: string
          quality: number
          reviewed_at?: string
          user_id: string
        }
        Update: {
          card_id?: string
          deck_id?: string
          id?: string
          quality?: number
          reviewed_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "flashcard_reviews_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "flashcards"
            referencedColumns: ["id"]
          },
        ]
      }
      flashcards: {
        Row: {
          back: string
          deck_id: string
          difficulty: string | null
          easiness_factor: number
          front: string
          id: string
          mastery_level: number
          next_review_at: string | null
          sort_order: number
          source_reference: string | null
          topic: string | null
        }
        Insert: {
          back: string
          deck_id: string
          difficulty?: string | null
          easiness_factor?: number
          front: string
          id?: string
          mastery_level?: number
          next_review_at?: string | null
          sort_order?: number
          source_reference?: string | null
          topic?: string | null
        }
        Update: {
          back?: string
          deck_id?: string
          difficulty?: string | null
          easiness_factor?: number
          front?: string
          id?: string
          mastery_level?: number
          next_review_at?: string | null
          sort_order?: number
          source_reference?: string | null
          topic?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "flashcards_deck_id_fkey"
            columns: ["deck_id"]
            isOneToOne: false
            referencedRelation: "flashcard_decks"
            referencedColumns: ["id"]
          },
        ]
      }
      focus_burst_sessions: {
        Row: {
          cards_reviewed: number
          completed: boolean
          duration_seconds: number
          id: string
          questions_answered: number
          started_at: string
          user_id: string
        }
        Insert: {
          cards_reviewed?: number
          completed?: boolean
          duration_seconds?: number
          id?: string
          questions_answered?: number
          started_at?: string
          user_id: string
        }
        Update: {
          cards_reviewed?: number
          completed?: boolean
          duration_seconds?: number
          id?: string
          questions_answered?: number
          started_at?: string
          user_id?: string
        }
        Relationships: []
      }
      focus_sessions: {
        Row: {
          completed: boolean
          duration_minutes: number
          ended_at: string | null
          id: string
          session_type: string
          started_at: string
          user_id: string
        }
        Insert: {
          completed?: boolean
          duration_minutes: number
          ended_at?: string | null
          id?: string
          session_type?: string
          started_at?: string
          user_id: string
        }
        Update: {
          completed?: boolean
          duration_minutes?: number
          ended_at?: string | null
          id?: string
          session_type?: string
          started_at?: string
          user_id?: string
        }
        Relationships: []
      }
      fortune_wheel_spins: {
        Row: {
          created_at: string
          id: string
          prize_type: string
          prize_value: string
          spin_date: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          prize_type: string
          prize_value: string
          spin_date?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          prize_type?: string
          prize_value?: string
          spin_date?: string
          user_id?: string
        }
        Relationships: []
      }
      generated_content: {
        Row: {
          content: Json
          content_type: string
          created_at: string
          document_id: string | null
          id: string
          share_token: string | null
          title: string | null
          user_id: string
        }
        Insert: {
          content?: Json
          content_type: string
          created_at?: string
          document_id?: string | null
          id?: string
          share_token?: string | null
          title?: string | null
          user_id: string
        }
        Update: {
          content?: Json
          content_type?: string
          created_at?: string
          document_id?: string | null
          id?: string
          share_token?: string | null
          title?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "generated_content_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      generation_jobs: {
        Row: {
          completed_at: string | null
          content_type: string
          created_at: string
          document_id: string | null
          error: string | null
          id: string
          result_id: string | null
          status: string
          title: string | null
          total_items: number | null
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          content_type: string
          created_at?: string
          document_id?: string | null
          error?: string | null
          id?: string
          result_id?: string | null
          status?: string
          title?: string | null
          total_items?: number | null
          user_id: string
        }
        Update: {
          completed_at?: string | null
          content_type?: string
          created_at?: string
          document_id?: string | null
          error?: string | null
          id?: string
          result_id?: string | null
          status?: string
          title?: string | null
          total_items?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "generation_jobs_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          achievement_notifications: boolean
          break_reminders: boolean
          created_at: string
          daily_summary: boolean
          focus_mode_enabled: boolean
          id: string
          notification_sound_url: string | null
          reminder_time: string
          study_reminder_enabled: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          achievement_notifications?: boolean
          break_reminders?: boolean
          created_at?: string
          daily_summary?: boolean
          focus_mode_enabled?: boolean
          id?: string
          notification_sound_url?: string | null
          reminder_time?: string
          study_reminder_enabled?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          achievement_notifications?: boolean
          break_reminders?: boolean
          created_at?: string
          daily_summary?: boolean
          focus_mode_enabled?: boolean
          id?: string
          notification_sound_url?: string | null
          reminder_time?: string
          study_reminder_enabled?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      powerup_purchases: {
        Row: {
          id: string
          powerup_type: string
          purchased_at: string
          user_id: string
          xp_cost: number
        }
        Insert: {
          id?: string
          powerup_type: string
          purchased_at?: string
          user_id: string
          xp_cost: number
        }
        Update: {
          id?: string
          powerup_type?: string
          purchased_at?: string
          user_id?: string
          xp_cost?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          adhd_traits: string[] | null
          avatar_url: string | null
          created_at: string
          energy_level: string
          exam_date: string | null
          exam_subject: string | null
          full_name: string | null
          goals: string[] | null
          id: string
          last_active_date: string | null
          onboarding_completed: boolean
          streak_count: number
          streak_shield_active: boolean
          study_level: string | null
          study_subject: string | null
          updated_at: string
          user_id: string
          weekly_goal_minutes: number
        }
        Insert: {
          adhd_traits?: string[] | null
          avatar_url?: string | null
          created_at?: string
          energy_level?: string
          exam_date?: string | null
          exam_subject?: string | null
          full_name?: string | null
          goals?: string[] | null
          id?: string
          last_active_date?: string | null
          onboarding_completed?: boolean
          streak_count?: number
          streak_shield_active?: boolean
          study_level?: string | null
          study_subject?: string | null
          updated_at?: string
          user_id: string
          weekly_goal_minutes?: number
        }
        Update: {
          adhd_traits?: string[] | null
          avatar_url?: string | null
          created_at?: string
          energy_level?: string
          exam_date?: string | null
          exam_subject?: string | null
          full_name?: string | null
          goals?: string[] | null
          id?: string
          last_active_date?: string | null
          onboarding_completed?: boolean
          streak_count?: number
          streak_shield_active?: boolean
          study_level?: string | null
          study_subject?: string | null
          updated_at?: string
          user_id?: string
          weekly_goal_minutes?: number
        }
        Relationships: []
      }
      quiz_attempts: {
        Row: {
          completed_at: string
          correct_answers: number
          id: string
          quiz_id: string
          score: number
          time_taken_seconds: number | null
          total_answered: number
          total_points: number
          user_id: string
          xp_bet: number | null
          xp_earned: number
        }
        Insert: {
          completed_at?: string
          correct_answers?: number
          id?: string
          quiz_id: string
          score?: number
          time_taken_seconds?: number | null
          total_answered?: number
          total_points?: number
          user_id: string
          xp_bet?: number | null
          xp_earned?: number
        }
        Update: {
          completed_at?: string
          correct_answers?: number
          id?: string
          quiz_id?: string
          score?: number
          time_taken_seconds?: number | null
          total_answered?: number
          total_points?: number
          user_id?: string
          xp_bet?: number | null
          xp_earned?: number
        }
        Relationships: [
          {
            foreignKeyName: "quiz_attempts_quiz_id_fkey"
            columns: ["quiz_id"]
            isOneToOne: false
            referencedRelation: "quizzes"
            referencedColumns: ["id"]
          },
        ]
      }
      quiz_question_feedback: {
        Row: {
          created_at: string
          id: string
          question_id: string
          rating: number
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          question_id: string
          rating: number
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          question_id?: string
          rating?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quiz_question_feedback_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "quiz_questions"
            referencedColumns: ["id"]
          },
        ]
      }
      quiz_questions: {
        Row: {
          correct_answer: number
          explanation: string | null
          id: string
          options: Json
          points: number
          question: string
          quiz_id: string
          sort_order: number
          source_reference: string | null
          time_limit_seconds: number | null
          topic: string | null
        }
        Insert: {
          correct_answer?: number
          explanation?: string | null
          id?: string
          options?: Json
          points?: number
          question: string
          quiz_id: string
          sort_order?: number
          source_reference?: string | null
          time_limit_seconds?: number | null
          topic?: string | null
        }
        Update: {
          correct_answer?: number
          explanation?: string | null
          id?: string
          options?: Json
          points?: number
          question?: string
          quiz_id?: string
          sort_order?: number
          source_reference?: string | null
          time_limit_seconds?: number | null
          topic?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quiz_questions_quiz_id_fkey"
            columns: ["quiz_id"]
            isOneToOne: false
            referencedRelation: "quizzes"
            referencedColumns: ["id"]
          },
        ]
      }
      quizzes: {
        Row: {
          created_at: string
          difficulty: string
          document_id: string | null
          id: string
          quiz_type: string
          share_token: string | null
          title: string
          topic: string | null
          total_questions: number
          user_id: string
        }
        Insert: {
          created_at?: string
          difficulty?: string
          document_id?: string | null
          id?: string
          quiz_type?: string
          share_token?: string | null
          title: string
          topic?: string | null
          total_questions?: number
          user_id: string
        }
        Update: {
          created_at?: string
          difficulty?: string
          document_id?: string | null
          id?: string
          quiz_type?: string
          share_token?: string | null
          title?: string
          topic?: string | null
          total_questions?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quizzes_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      referral_codes: {
        Row: {
          code: string
          created_at: string
          credits_earned: number
          discount_percent: number
          friends_joined: number
          id: string
          max_uses: number
          times_used: number
          user_id: string
        }
        Insert: {
          code: string
          created_at?: string
          credits_earned?: number
          discount_percent?: number
          friends_joined?: number
          id?: string
          max_uses?: number
          times_used?: number
          user_id: string
        }
        Update: {
          code?: string
          created_at?: string
          credits_earned?: number
          discount_percent?: number
          friends_joined?: number
          id?: string
          max_uses?: number
          times_used?: number
          user_id?: string
        }
        Relationships: []
      }
      referral_uses: {
        Row: {
          created_at: string
          discount_applied: number
          id: string
          referral_code_id: string
          referred_user_id: string
          referrer_user_id: string
        }
        Insert: {
          created_at?: string
          discount_applied: number
          id?: string
          referral_code_id: string
          referred_user_id: string
          referrer_user_id: string
        }
        Update: {
          created_at?: string
          discount_applied?: number
          id?: string
          referral_code_id?: string
          referred_user_id?: string
          referrer_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "referral_uses_referral_code_id_fkey"
            columns: ["referral_code_id"]
            isOneToOne: false
            referencedRelation: "referral_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      study_plans: {
        Row: {
          created_at: string
          energy_level: string
          id: string
          plan_data: Json
          status: string
          user_id: string
          week_end: string
          week_start: string
        }
        Insert: {
          created_at?: string
          energy_level?: string
          id?: string
          plan_data?: Json
          status?: string
          user_id: string
          week_end: string
          week_start: string
        }
        Update: {
          created_at?: string
          energy_level?: string
          id?: string
          plan_data?: Json
          status?: string
          user_id?: string
          week_end?: string
          week_start?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          id: string
          is_trial: boolean
          paypal_subscription_id: string | null
          plan_name: string
          status: string
          trial_end_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          is_trial?: boolean
          paypal_subscription_id?: string | null
          plan_name: string
          status?: string
          trial_end_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          is_trial?: boolean
          paypal_subscription_id?: string | null
          plan_name?: string
          status?: string
          trial_end_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      support_tickets: {
        Row: {
          ai_response: string | null
          created_at: string
          id: string
          message: string
          priority: string
          status: string
          subject: string
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_response?: string | null
          created_at?: string
          id?: string
          message: string
          priority?: string
          status?: string
          subject: string
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_response?: string | null
          created_at?: string
          id?: string
          message?: string
          priority?: string
          status?: string
          subject?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      tasks: {
        Row: {
          completed: boolean
          created_at: string
          description: string | null
          due_date: string | null
          estimated_minutes: number | null
          id: string
          parent_task_id: string | null
          priority: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          completed?: boolean
          created_at?: string
          description?: string | null
          due_date?: string | null
          estimated_minutes?: number | null
          id?: string
          parent_task_id?: string | null
          priority?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          completed?: boolean
          created_at?: string
          description?: string | null
          due_date?: string | null
          estimated_minutes?: number | null
          id?: string
          parent_task_id?: string | null
          priority?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_messages: {
        Row: {
          created_at: string
          id: string
          message: string
          sender_type: string
          ticket_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          sender_type?: string
          ticket_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          sender_type?: string
          ticket_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_messages_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      user_challenge_progress: {
        Row: {
          challenge_id: string
          completed: boolean
          completed_at: string | null
          created_at: string
          current_value: number
          id: string
          reward_claimed: boolean
          user_id: string
        }
        Insert: {
          challenge_id: string
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          current_value?: number
          id?: string
          reward_claimed?: boolean
          user_id: string
        }
        Update: {
          challenge_id?: string
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          current_value?: number
          id?: string
          reward_claimed?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_challenge_progress_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "weekly_challenges"
            referencedColumns: ["id"]
          },
        ]
      }
      user_credits: {
        Row: {
          balance: number
          created_at: string
          id: string
          last_refill_at: string
          rollover_balance: number
          updated_at: string
          user_id: string
        }
        Insert: {
          balance?: number
          created_at?: string
          id?: string
          last_refill_at?: string
          rollover_balance?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          balance?: number
          created_at?: string
          id?: string
          last_refill_at?: string
          rollover_balance?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_powerups: {
        Row: {
          id: string
          powerup_type: string
          quantity: number
          updated_at: string
          user_id: string
        }
        Insert: {
          id?: string
          powerup_type: string
          quantity?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          id?: string
          powerup_type?: string
          quantity?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_question_progress: {
        Row: {
          answered_at: string
          id: string
          is_correct: boolean
          question_id: string
          quiz_id: string
          selected_answer: number
          time_taken_seconds: number | null
          user_id: string
        }
        Insert: {
          answered_at?: string
          id?: string
          is_correct: boolean
          question_id: string
          quiz_id: string
          selected_answer: number
          time_taken_seconds?: number | null
          user_id: string
        }
        Update: {
          answered_at?: string
          id?: string
          is_correct?: boolean
          question_id?: string
          quiz_id?: string
          selected_answer?: number
          time_taken_seconds?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_question_progress_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "quiz_questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_question_progress_quiz_id_fkey"
            columns: ["quiz_id"]
            isOneToOne: false
            referencedRelation: "quizzes"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_xp: {
        Row: {
          current_streak: number
          id: string
          level: number
          perfect_scores: number
          quizzes_completed: number
          total_xp: number
          updated_at: string
          user_id: string
        }
        Insert: {
          current_streak?: number
          id?: string
          level?: number
          perfect_scores?: number
          quizzes_completed?: number
          total_xp?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          current_streak?: number
          id?: string
          level?: number
          perfect_scores?: number
          quizzes_completed?: number
          total_xp?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      weekly_challenges: {
        Row: {
          challenge_type: string
          created_at: string
          description: string
          icon: string
          id: string
          target_value: number
          title: string
          week_end: string
          week_start: string
          xp_reward: number
        }
        Insert: {
          challenge_type: string
          created_at?: string
          description: string
          icon?: string
          id?: string
          target_value: number
          title: string
          week_end: string
          week_start: string
          xp_reward?: number
        }
        Update: {
          challenge_type?: string
          created_at?: string
          description?: string
          icon?: string
          id?: string
          target_value?: number
          title?: string
          week_end?: string
          week_start?: string
          xp_reward?: number
        }
        Relationships: []
      }
      xp_log: {
        Row: {
          earned_at: string
          id: string
          source: string
          source_id: string | null
          user_id: string
          xp_amount: number
        }
        Insert: {
          earned_at?: string
          id?: string
          source: string
          source_id?: string | null
          user_id: string
          xp_amount: number
        }
        Update: {
          earned_at?: string
          id?: string
          source?: string
          source_id?: string | null
          user_id?: string
          xp_amount?: number
        }
        Relationships: []
      }
    }
    Views: {
      leaderboard_view: {
        Row: {
          avatar_url: string | null
          current_streak: number | null
          full_name: string | null
          level: number | null
          quizzes_completed: number | null
          streak_count: number | null
          total_xp: number | null
          user_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      activate_trial: {
        Args: { _days?: number; _plan_name?: string; _user_id: string }
        Returns: boolean
      }
      award_achievement: {
        Args: { _achievement_type: string; _user_id: string }
        Returns: boolean
      }
      count_due_cards: { Args: { _user_id: string }; Returns: number }
      get_due_cards: {
        Args: { _limit?: number; _user_id: string }
        Returns: {
          back: string
          deck_id: string
          deck_title: string
          easiness_factor: number
          front: string
          id: string
          mastery_level: number
          next_review_at: string
          topic: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      maybe_refill_credits: { Args: { _user_id: string }; Returns: Json }
      spend_credits: {
        Args: {
          _action: string
          _cost: number
          _description?: string
          _user_id: string
        }
        Returns: Json
      }
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
