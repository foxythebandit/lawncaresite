
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "agreement_schedule_revisions": {
                  Row: {
                    "agreement_id": string,"created_at": string,"definition": NonNullable<Json>,"ends_before": string | null,"id": string,"items_template": NonNullable<Json>,"starts_on": string,"visit_time": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "agreement_id": string,"created_at"?: string,"definition": NonNullable<Json>,"ends_before"?: string | null,"id"?: string,"items_template": NonNullable<Json>,"starts_on": string,"visit_time"?: string | null
                  }
                  Update: {
                    "agreement_id"?: string,"created_at"?: string,"definition"?: NonNullable<Json>,"ends_before"?: string | null,"id"?: string,"items_template"?: NonNullable<Json>,"starts_on"?: string,"visit_time"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "agreement_schedule_revisions_agreement_id_fkey"
      columns: ["agreement_id"]
isOneToOne: false
      referencedRelation: "recurring_agreements"
      referencedColumns: ["id"]
    }
                  ]
                },"bookings": {
                  Row: {
                    "accepted_quote_snapshot": Json | null,"addon_interest": Json | null,"address": string,"agreement_id": string | null,"amount_charged": number | null,"attribution": NonNullable<Json>,"completed_at": string | null,"completion_operation_id": string | null,"confirmed_at": string | null,"confirmed_date": string | null,"confirmed_time": string | null,"created_at": string,"creation_operation_id": string | null,"creation_request": Json | null,"customer_id": string | null,"customer_notes": string | null,"email": string | null,"first_visit_price": number | null,"frequency": string | null,"gbraid": string | null,"gclid": string | null,"google_ad_id": string | null,"google_adgroup_id": string | null,"google_campaign_id": string | null,"id": string,"job_total": number | null,"last_mow": string | null,"last_reminder_sent_at": string | null,"lawn_size_bucket": string | null,"lead_id": string | null,"lifecycle_note": string | null,"manual_quote": boolean,"map_screenshot_url": string | null,"name": string,"next_visit_date": string | null,"notes": string | null,"notify_failed": boolean,"occurrence_on": string | null,"one_time": boolean,"original_occurrence_on": string | null,"overgrowth_fee": number | null,"payment_link": string | null,"payment_method": string | null,"payment_recorded_at": string | null,"phone": string,"preferred_date": string | null,"preferred_time": string | null,"price_per_visit": number | null,"property_id": string | null,"pushover_receipt": string | null,"schedule_revision_id": string | null,"schedule_state": string | null,"sq_ft": number | null,"status": string,"updated_at": string,"utm_campaign": string | null,"utm_content": string | null,"utm_medium": string | null,"utm_source": string | null,"utm_term": string | null,"wbraid": string | null,"crm_calendar_search_date": string | null
                  }
                  ComputedFields: "crm_calendar_search_date"
                  Insert: {
                    "accepted_quote_snapshot"?: Json | null,"addon_interest"?: Json | null,"address": string,"agreement_id"?: string | null,"amount_charged"?: number | null,"attribution"?: NonNullable<Json>,"completed_at"?: string | null,"completion_operation_id"?: string | null,"confirmed_at"?: string | null,"confirmed_date"?: string | null,"confirmed_time"?: string | null,"created_at"?: string,"creation_operation_id"?: string | null,"creation_request"?: Json | null,"customer_id"?: string | null,"customer_notes"?: string | null,"email"?: string | null,"first_visit_price"?: number | null,"frequency"?: string | null,"gbraid"?: string | null,"gclid"?: string | null,"google_ad_id"?: string | null,"google_adgroup_id"?: string | null,"google_campaign_id"?: string | null,"id"?: string,"job_total"?: number | null,"last_mow"?: string | null,"last_reminder_sent_at"?: string | null,"lawn_size_bucket"?: string | null,"lead_id"?: string | null,"lifecycle_note"?: string | null,"manual_quote"?: boolean,"map_screenshot_url"?: string | null,"name": string,"next_visit_date"?: string | null,"notes"?: string | null,"notify_failed"?: boolean,"occurrence_on"?: string | null,"one_time"?: boolean,"original_occurrence_on"?: string | null,"overgrowth_fee"?: number | null,"payment_link"?: string | null,"payment_method"?: string | null,"payment_recorded_at"?: string | null,"phone": string,"preferred_date"?: string | null,"preferred_time"?: string | null,"price_per_visit"?: number | null,"property_id"?: string | null,"pushover_receipt"?: string | null,"schedule_revision_id"?: string | null,"schedule_state"?: string | null,"sq_ft"?: number | null,"status"?: string,"updated_at"?: string,"utm_campaign"?: string | null,"utm_content"?: string | null,"utm_medium"?: string | null,"utm_source"?: string | null,"utm_term"?: string | null,"wbraid"?: string | null
                  }
                  Update: {
                    "accepted_quote_snapshot"?: Json | null,"addon_interest"?: Json | null,"address"?: string,"agreement_id"?: string | null,"amount_charged"?: number | null,"attribution"?: NonNullable<Json>,"completed_at"?: string | null,"completion_operation_id"?: string | null,"confirmed_at"?: string | null,"confirmed_date"?: string | null,"confirmed_time"?: string | null,"created_at"?: string,"creation_operation_id"?: string | null,"creation_request"?: Json | null,"customer_id"?: string | null,"customer_notes"?: string | null,"email"?: string | null,"first_visit_price"?: number | null,"frequency"?: string | null,"gbraid"?: string | null,"gclid"?: string | null,"google_ad_id"?: string | null,"google_adgroup_id"?: string | null,"google_campaign_id"?: string | null,"id"?: string,"job_total"?: number | null,"last_mow"?: string | null,"last_reminder_sent_at"?: string | null,"lawn_size_bucket"?: string | null,"lead_id"?: string | null,"lifecycle_note"?: string | null,"manual_quote"?: boolean,"map_screenshot_url"?: string | null,"name"?: string,"next_visit_date"?: string | null,"notes"?: string | null,"notify_failed"?: boolean,"occurrence_on"?: string | null,"one_time"?: boolean,"original_occurrence_on"?: string | null,"overgrowth_fee"?: number | null,"payment_link"?: string | null,"payment_method"?: string | null,"payment_recorded_at"?: string | null,"phone"?: string,"preferred_date"?: string | null,"preferred_time"?: string | null,"price_per_visit"?: number | null,"property_id"?: string | null,"pushover_receipt"?: string | null,"schedule_revision_id"?: string | null,"schedule_state"?: string | null,"sq_ft"?: number | null,"status"?: string,"updated_at"?: string,"utm_campaign"?: string | null,"utm_content"?: string | null,"utm_medium"?: string | null,"utm_source"?: string | null,"utm_term"?: string | null,"wbraid"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "bookings_agreement_id_fkey"
      columns: ["agreement_id"]
isOneToOne: false
      referencedRelation: "recurring_agreements"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "bookings_agreement_identity_fk"
      columns: ["agreement_id","customer_id","property_id"]
isOneToOne: false
      referencedRelation: "recurring_agreements"
      referencedColumns: ["id","customer_id","property_id"]
    },{
      foreignKeyName: "bookings_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "bookings_lead_id_fkey"
      columns: ["lead_id"]
isOneToOne: false
      referencedRelation: "leads"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "bookings_property_customer_fk"
      columns: ["property_id","customer_id"]
isOneToOne: false
      referencedRelation: "properties"
      referencedColumns: ["id","customer_id"]
    },{
      foreignKeyName: "bookings_schedule_revision_fk"
      columns: ["schedule_revision_id","agreement_id"]
isOneToOne: false
      referencedRelation: "agreement_schedule_revisions"
      referencedColumns: ["id","agreement_id"]
    }
                  ]
                },"crm_operations": {
                  Row: {
                    "action": string,"created_at": string,"id": string,"request": NonNullable<Json>,"result": NonNullable<Json>,"target_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"created_at"?: string,"id": string,"request": NonNullable<Json>,"result": NonNullable<Json>,"target_id": string
                  }
                  Update: {
                    "action"?: string,"created_at"?: string,"id"?: string,"request"?: NonNullable<Json>,"result"?: NonNullable<Json>,"target_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"customers": {
                  Row: {
                    "archived_at": string | null,"created_at": string,"email": string | null,"id": string,"name": string | null,"phone": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"created_at"?: string,"email"?: string | null,"id"?: string,"name"?: string | null,"phone"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "archived_at"?: string | null,"created_at"?: string,"email"?: string | null,"id"?: string,"name"?: string | null,"phone"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"extra_charges": {
                  Row: {
                    "amount": number,"charged_on": string,"client_name": string,"created_at": string,"description": string,"id": string,"payment_method": string | null,"phone": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"charged_on"?: string,"client_name": string,"created_at"?: string,"description": string,"id"?: string,"payment_method"?: string | null,"phone"?: string | null
                  }
                  Update: {
                    "amount"?: number,"charged_on"?: string,"client_name"?: string,"created_at"?: string,"description"?: string,"id"?: string,"payment_method"?: string | null,"phone"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"intake_events": {
                  Row: {
                    "alert_version": number,"booking_id": string | null,"created_at": string,"id": string,"lead_id": string,"payload_hash": string,"source": string,"submission_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "alert_version"?: number,"booking_id"?: string | null,"created_at"?: string,"id"?: string,"lead_id": string,"payload_hash": string,"source": string,"submission_id": string
                  }
                  Update: {
                    "alert_version"?: number,"booking_id"?: string | null,"created_at"?: string,"id"?: string,"lead_id"?: string,"payload_hash"?: string,"source"?: string,"submission_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "intake_events_booking_id_fkey"
      columns: ["booking_id"]
isOneToOne: false
      referencedRelation: "bookings"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "intake_events_lead_id_fkey"
      columns: ["lead_id"]
isOneToOne: false
      referencedRelation: "leads"
      referencedColumns: ["id"]
    }
                  ]
                },"job_items": {
                  Row: {
                    "amount": number,"booking_id": string,"created_at": string,"description": string,"id": string,"kind": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"booking_id": string,"created_at"?: string,"description": string,"id"?: string,"kind": string
                  }
                  Update: {
                    "amount"?: number,"booking_id"?: string,"created_at"?: string,"description"?: string,"id"?: string,"kind"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "job_items_booking_id_fkey"
      columns: ["booking_id"]
isOneToOne: false
      referencedRelation: "bookings"
      referencedColumns: ["id"]
    }
                  ]
                },"job_payments": {
                  Row: {
                    "amount": number,"booking_id": string,"created_at": string,"currency": string,"id": string,"method": string,"operation_id": string,"paid_on": string,"provenance": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"booking_id": string,"created_at"?: string,"currency"?: string,"id"?: string,"method": string,"operation_id": string,"paid_on": string,"provenance": string
                  }
                  Update: {
                    "amount"?: number,"booking_id"?: string,"created_at"?: string,"currency"?: string,"id"?: string,"method"?: string,"operation_id"?: string,"paid_on"?: string,"provenance"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "job_payments_booking_id_fkey"
      columns: ["booking_id"]
isOneToOne: false
      referencedRelation: "bookings"
      referencedColumns: ["id"]
    }
                  ]
                },"lead_activities": {
                  Row: {
                    "actor_email": string | null,"body": string | null,"data": Json | null,"id": string,"kind": string,"lead_id": string,"occurred_at": string,"operation_id": string | null,"outcome": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_email"?: string | null,"body"?: string | null,"data"?: Json | null,"id"?: string,"kind": string,"lead_id": string,"occurred_at"?: string,"operation_id"?: string | null,"outcome"?: string | null
                  }
                  Update: {
                    "actor_email"?: string | null,"body"?: string | null,"data"?: Json | null,"id"?: string,"kind"?: string,"lead_id"?: string,"occurred_at"?: string,"operation_id"?: string | null,"outcome"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "lead_activities_lead_id_fkey"
      columns: ["lead_id"]
isOneToOne: false
      referencedRelation: "leads"
      referencedColumns: ["id"]
    }
                  ]
                },"lead_calls": {
                  Row: {
                    "answered_at": string | null,"call_sid": string | null,"caller_id": string | null,"created_at": string,"digits": string | null,"duration_seconds": number | null,"ended_at": string | null,"error_code": string | null,"event_id": string | null,"id": string,"lead_id": string,"leg": string,"parent_call_sid": string | null,"recording_duration_seconds": number | null,"recording_sid": string | null,"result": string | null,"staff_name": string | null,"staff_phone": string,"status": string,"to_phone": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "answered_at"?: string | null,"call_sid"?: string | null,"caller_id"?: string | null,"created_at"?: string,"digits"?: string | null,"duration_seconds"?: number | null,"ended_at"?: string | null,"error_code"?: string | null,"event_id"?: string | null,"id"?: string,"lead_id": string,"leg": string,"parent_call_sid"?: string | null,"recording_duration_seconds"?: number | null,"recording_sid"?: string | null,"result"?: string | null,"staff_name"?: string | null,"staff_phone": string,"status"?: string,"to_phone": string,"updated_at"?: string
                  }
                  Update: {
                    "answered_at"?: string | null,"call_sid"?: string | null,"caller_id"?: string | null,"created_at"?: string,"digits"?: string | null,"duration_seconds"?: number | null,"ended_at"?: string | null,"error_code"?: string | null,"event_id"?: string | null,"id"?: string,"lead_id"?: string,"leg"?: string,"parent_call_sid"?: string | null,"recording_duration_seconds"?: number | null,"recording_sid"?: string | null,"result"?: string | null,"staff_name"?: string | null,"staff_phone"?: string,"status"?: string,"to_phone"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "lead_calls_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "intake_events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lead_calls_lead_id_fkey"
      columns: ["lead_id"]
isOneToOne: false
      referencedRelation: "leads"
      referencedColumns: ["id"]
    }
                  ]
                },"leads": {
                  Row: {
                    "accepted_quote_snapshot": Json | null,"address": string | null,"answers": NonNullable<Json>,"attribution": NonNullable<Json>,"board_column": string,"board_moved_at": string | null,"call_attempts": number,"call_log_reminded_at": string | null,"check_back_on": string | null,"closed_reason": string | null,"consent": boolean,"consent_text": string | null,"consent_version": string | null,"consented_at": string | null,"contact_outcome": string | null,"created_at": string,"customer_canceled_at": string | null,"customer_dial_call_sid": string | null,"customer_id": string | null,"email": string | null,"estimated_value": number | null,"external_submission_id": string | null,"first_visit_on": string | null,"follow_up_at": string | null,"form_version": string | null,"frequency": string | null,"gbraid": string | null,"gclid": string | null,"google_ad_id": string | null,"google_adgroup_id": string | null,"google_campaign_id": string | null,"id": string,"lawn_tracing": Json | null,"map_screenshot_url": string | null,"name": string | null,"needs_call_log_at": string | null,"not_taken_at": string | null,"phone": string,"phone_frequency": string | null,"phone_price_at": string | null,"phone_price_cents": number | null,"property_id": string | null,"pushover_receipt": string | null,"quote_accepted_at": string | null,"quote_confirmed_at": string | null,"quote_draft": Json | null,"quote_emailed_at": string | null,"quote_saved_at": string | null,"quote_status": string,"quoted_reason": string | null,"score": number | null,"services": NonNullable<Json>,"short_code": string,"source": string,"sq_ft": number | null,"stage": string,"taken_at": string | null,"taken_by": string | null,"taken_by_phone": string | null,"timing": string | null,"updated_at": string,"utm_campaign": string | null,"utm_content": string | null,"utm_medium": string | null,"utm_source": string | null,"utm_term": string | null,"wbraid": string | null,"website_first_visit_cents": number | null,"website_frequency": string | null,"website_price_at": string | null,"website_price_cents": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "accepted_quote_snapshot"?: Json | null,"address"?: string | null,"answers"?: NonNullable<Json>,"attribution"?: NonNullable<Json>,"board_column"?: string,"board_moved_at"?: string | null,"call_attempts"?: number,"call_log_reminded_at"?: string | null,"check_back_on"?: string | null,"closed_reason"?: string | null,"consent"?: boolean,"consent_text"?: string | null,"consent_version"?: string | null,"consented_at"?: string | null,"contact_outcome"?: string | null,"created_at"?: string,"customer_canceled_at"?: string | null,"customer_dial_call_sid"?: string | null,"customer_id"?: string | null,"email"?: string | null,"estimated_value"?: number | null,"external_submission_id"?: string | null,"first_visit_on"?: string | null,"follow_up_at"?: string | null,"form_version"?: string | null,"frequency"?: string | null,"gbraid"?: string | null,"gclid"?: string | null,"google_ad_id"?: string | null,"google_adgroup_id"?: string | null,"google_campaign_id"?: string | null,"id"?: string,"lawn_tracing"?: Json | null,"map_screenshot_url"?: string | null,"name"?: string | null,"needs_call_log_at"?: string | null,"not_taken_at"?: string | null,"phone": string,"phone_frequency"?: string | null,"phone_price_at"?: string | null,"phone_price_cents"?: number | null,"property_id"?: string | null,"pushover_receipt"?: string | null,"quote_accepted_at"?: string | null,"quote_confirmed_at"?: string | null,"quote_draft"?: Json | null,"quote_emailed_at"?: string | null,"quote_saved_at"?: string | null,"quote_status"?: string,"quoted_reason"?: string | null,"score"?: number | null,"services"?: NonNullable<Json>,"short_code": string,"source"?: string,"sq_ft"?: number | null,"stage"?: string,"taken_at"?: string | null,"taken_by"?: string | null,"taken_by_phone"?: string | null,"timing"?: string | null,"updated_at"?: string,"utm_campaign"?: string | null,"utm_content"?: string | null,"utm_medium"?: string | null,"utm_source"?: string | null,"utm_term"?: string | null,"wbraid"?: string | null,"website_first_visit_cents"?: number | null,"website_frequency"?: string | null,"website_price_at"?: string | null,"website_price_cents"?: number | null
                  }
                  Update: {
                    "accepted_quote_snapshot"?: Json | null,"address"?: string | null,"answers"?: NonNullable<Json>,"attribution"?: NonNullable<Json>,"board_column"?: string,"board_moved_at"?: string | null,"call_attempts"?: number,"call_log_reminded_at"?: string | null,"check_back_on"?: string | null,"closed_reason"?: string | null,"consent"?: boolean,"consent_text"?: string | null,"consent_version"?: string | null,"consented_at"?: string | null,"contact_outcome"?: string | null,"created_at"?: string,"customer_canceled_at"?: string | null,"customer_dial_call_sid"?: string | null,"customer_id"?: string | null,"email"?: string | null,"estimated_value"?: number | null,"external_submission_id"?: string | null,"first_visit_on"?: string | null,"follow_up_at"?: string | null,"form_version"?: string | null,"frequency"?: string | null,"gbraid"?: string | null,"gclid"?: string | null,"google_ad_id"?: string | null,"google_adgroup_id"?: string | null,"google_campaign_id"?: string | null,"id"?: string,"lawn_tracing"?: Json | null,"map_screenshot_url"?: string | null,"name"?: string | null,"needs_call_log_at"?: string | null,"not_taken_at"?: string | null,"phone"?: string,"phone_frequency"?: string | null,"phone_price_at"?: string | null,"phone_price_cents"?: number | null,"property_id"?: string | null,"pushover_receipt"?: string | null,"quote_accepted_at"?: string | null,"quote_confirmed_at"?: string | null,"quote_draft"?: Json | null,"quote_emailed_at"?: string | null,"quote_saved_at"?: string | null,"quote_status"?: string,"quoted_reason"?: string | null,"score"?: number | null,"services"?: NonNullable<Json>,"short_code"?: string,"source"?: string,"sq_ft"?: number | null,"stage"?: string,"taken_at"?: string | null,"taken_by"?: string | null,"taken_by_phone"?: string | null,"timing"?: string | null,"updated_at"?: string,"utm_campaign"?: string | null,"utm_content"?: string | null,"utm_medium"?: string | null,"utm_source"?: string | null,"utm_term"?: string | null,"wbraid"?: string | null,"website_first_visit_cents"?: number | null,"website_frequency"?: string | null,"website_price_at"?: string | null,"website_price_cents"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "leads_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "leads_property_customer_fk"
      columns: ["property_id","customer_id"]
isOneToOne: false
      referencedRelation: "properties"
      referencedColumns: ["id","customer_id"]
    }
                  ]
                },"properties": {
                  Row: {
                    "address": string,"created_at": string,"customer_id": string,"id": string,"latitude": number | null,"longitude": number | null,"measured_at": string | null,"measurement_context": Json | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "address": string,"created_at"?: string,"customer_id": string,"id"?: string,"latitude"?: number | null,"longitude"?: number | null,"measured_at"?: string | null,"measurement_context"?: Json | null,"updated_at"?: string
                  }
                  Update: {
                    "address"?: string,"created_at"?: string,"customer_id"?: string,"id"?: string,"latitude"?: number | null,"longitude"?: number | null,"measured_at"?: string | null,"measurement_context"?: Json | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "properties_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["id"]
    }
                  ]
                },"quotes": {
                  Row: {
                    "created_at": string,"id": string,"name": string,"phone": string,"postcode": string,"yard_size": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"name": string,"phone": string,"postcode": string,"yard_size": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"name"?: string,"phone"?: string,"postcode"?: string,"yard_size"?: string
                  }
                  Relationships: [
                    
                  ]
                },"recurring_agreements": {
                  Row: {
                    "anchor_on": string,"created_at": string,"customer_id": string,"end_on": string | null,"generated_through": string | null,"generation_starts_on": string | null,"id": string,"interval_count": number,"interval_unit": string,"items_template": NonNullable<Json>,"next_on": string,"price_per_visit": number | null,"property_id": string,"schedule_review_reason": string | null,"schedule_source_booking_id": string | null,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "anchor_on": string,"created_at"?: string,"customer_id": string,"end_on"?: string | null,"generated_through"?: string | null,"generation_starts_on"?: string | null,"id"?: string,"interval_count": number,"interval_unit": string,"items_template"?: NonNullable<Json>,"next_on": string,"price_per_visit"?: number | null,"property_id": string,"schedule_review_reason"?: string | null,"schedule_source_booking_id"?: string | null,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "anchor_on"?: string,"created_at"?: string,"customer_id"?: string,"end_on"?: string | null,"generated_through"?: string | null,"generation_starts_on"?: string | null,"id"?: string,"interval_count"?: number,"interval_unit"?: string,"items_template"?: NonNullable<Json>,"next_on"?: string,"price_per_visit"?: number | null,"property_id"?: string,"schedule_review_reason"?: string | null,"schedule_source_booking_id"?: string | null,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "agreements_property_customer_fk"
      columns: ["property_id","customer_id"]
isOneToOne: false
      referencedRelation: "properties"
      referencedColumns: ["id","customer_id"]
    },{
      foreignKeyName: "recurring_agreements_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "recurring_agreements_schedule_source_booking_id_fkey"
      columns: ["schedule_source_booking_id"]
isOneToOne: false
      referencedRelation: "bookings"
      referencedColumns: ["id"]
    }
                  ]
                },"staff_alerts": {
                  Row: {
                    "attempts": number,"channel": string,"error_code": string | null,"event_id": string,"id": string,"provider_sid": string | null,"provider_status": string | null,"recipient": string,"state": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"channel"?: string,"error_code"?: string | null,"event_id": string,"id"?: string,"provider_sid"?: string | null,"provider_status"?: string | null,"recipient"?: string,"state"?: string,"updated_at"?: string
                  }
                  Update: {
                    "attempts"?: number,"channel"?: string,"error_code"?: string | null,"event_id"?: string,"id"?: string,"provider_sid"?: string | null,"provider_status"?: string | null,"recipient"?: string,"state"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "staff_alerts_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "intake_events"
      referencedColumns: ["id"]
    }
                  ]
                },"staff_texts": {
                  Row: {
                    "attempts": number,"body": string,"created_at": string,"dedupe_key": string,"error_code": string | null,"event_id": string | null,"has_media": boolean,"id": string,"kind": string,"lead_id": string,"provider_sid": string | null,"provider_status": string | null,"recipient": string,"state": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"body"?: string,"created_at"?: string,"dedupe_key": string,"error_code"?: string | null,"event_id"?: string | null,"has_media"?: boolean,"id"?: string,"kind": string,"lead_id": string,"provider_sid"?: string | null,"provider_status"?: string | null,"recipient": string,"state"?: string,"updated_at"?: string
                  }
                  Update: {
                    "attempts"?: number,"body"?: string,"created_at"?: string,"dedupe_key"?: string,"error_code"?: string | null,"event_id"?: string | null,"has_media"?: boolean,"id"?: string,"kind"?: string,"lead_id"?: string,"provider_sid"?: string | null,"provider_status"?: string | null,"recipient"?: string,"state"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "staff_texts_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "intake_events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "staff_texts_lead_id_fkey"
      columns: ["lead_id"]
isOneToOne: false
      referencedRelation: "leads"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "complete_job":
{ Args: { "p_booking_id": string,"p_expected_updated_at": string,"p_operation_id": string }; Returns: Json
                           } |
{ Args: { "p_booking_id": string,"p_completed_on": string,"p_expected_updated_at": string,"p_operation_id": string }; Returns: Json
                           },
"completed_job_count":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"create_job_from_quote":
{ Args: { "p_expected_updated_at": string,"p_items": Json,"p_job": Json,"p_lead_id": string,"p_operation_id": string }; Returns: Json
                           },
"crm_activate_schedule":
{ Args: { "p_agreement_id": string,"p_legacy"?: boolean,"p_source_id": string }; Returns: undefined
                           },
"crm_agreement_command":
{ Args: { "p_action": string,"p_agreement_id": string,"p_expected_updated_at": string,"p_operation_id": string,"p_payload": Json }; Returns: Json
                           },
"crm_alert_leg_start":
{ Args: { "p_event_id": string,"p_lead_id": string,"p_staff_name": string,"p_staff_phone": string }; Returns: Json
                           },
"crm_alert_leg_status":
{ Args: { "p_call_id": string,"p_call_sid": string,"p_duration": number,"p_status": string }; Returns: Json
                           },
"crm_alert_press":
{ Args: { "p_call_id": string,"p_call_sid": string,"p_caller_id": string,"p_digit": string }; Returns: Json
                           },
"crm_attach_to_agreement":
{ Args: { "p_agreement_id": string,"p_booking_id": string,"p_expected_updated_at": string,"p_operation_id": string }; Returns: Json
                           },
"crm_calendar_attention":
{ Args: { "p_today"?: string }; Returns: Json
                           },
"crm_calendar_attention_page":
{ Args: { "p_kind"?: string,"p_limit"?: number,"p_offset"?: number,"p_today": string }; Returns: Json
                           },
"crm_calendar_edit_occurrence":
{ Args: { "p_action": string,"p_agreement_id": string,"p_on": string,"p_operation_id": string,"p_payload": Json,"p_revision_id": string }; Returns: Json
                           },
"crm_calendar_entries":
{ Args: { "p_from": string,"p_through": string }; Returns: {
              "address": string,"agreement_id": string,"booking_id": string,"cadence_on": string,"customer_id": string,"job_total": number,"name": string,"property_id": string,"revision_id": string,"service_on": string,"visit_status": string,"visit_time": string
            }[]
                           },
"crm_calendar_save_note":
{ Args: { "p_booking_id": string,"p_expected_updated_at": string,"p_note": string,"p_operation_id": string }; Returns: Json
                           },
"crm_calendar_search_date":
{ Args: { "": Database["public"]['Tables']["bookings"]['Row'] }; Returns: { error: true } & "the function public.crm_calendar_search_date with parameter or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache"
                           },
"crm_claim_lead":
{ Args: { "p_call_sid": string,"p_lead_id": string,"p_staff_name": string,"p_staff_phone": string }; Returns: Json
                           },
"crm_create_call_job":
{ Args: { "p_items": Json,"p_job": Json,"p_lead_id": string,"p_operation_id": string }; Returns: Json
                           },
"crm_create_customer_job":
{ Args: { "p_customer_id": string,"p_items": Json,"p_job": Json,"p_operation_id": string,"p_property": Json,"p_property_id": string }; Returns: Json
                           },
"crm_finish_customer_leg":
{ Args: { "p_call_sid": string,"p_caller_id": string,"p_duration": number,"p_lead_id": string,"p_parent_call_sid": string,"p_result": string,"p_staff_name": string,"p_staff_phone": string,"p_to_phone": string }; Returns: Json
                           },
"crm_generate_next_job":
{ Args: { "p_after": string,"p_booking_id": string,"p_force_on"?: string }; Returns: string
                           },
"crm_job_command":
{ Args: { "p_action": string,"p_booking_id": string,"p_expected_updated_at": string,"p_operation_id": string,"p_payload": Json }; Returns: Json
                           },
"crm_legacy_schedule":
{ Args: { "p_anchor": string,"p_count": number,"p_first"?: string,"p_unit": string }; Returns: Json
                           },
"crm_link_job":
{ Args: { "p_booking_id": string,"p_customer": Json,"p_customer_id": string,"p_expected_updated_at": string,"p_operation_id": string,"p_property": Json,"p_property_id": string }; Returns: Json
                           },
"crm_log_call":
{ Args: { "p_actor_email": string,"p_detail": Json,"p_lead_id": string,"p_operation_id": string,"p_outcome": string }; Returns: Json
                           },
"crm_materialize_schedule_visit":
{ Args: { "p_agreement_id": string,"p_on": string,"p_revision_id": string }; Returns: string
                           },
"crm_move_lead":
{ Args: { "p_actor_email": string,"p_column": string,"p_detail": Json,"p_lead_id": string }; Returns: Json
                           },
"crm_next_occurrence":
{ Args: { "p_after": string,"p_anchor": string,"p_count": number,"p_unit": string }; Returns: string
                           },
"crm_operation_reply":
{ Args: { "p_action": string,"p_id": string,"p_request": Json,"p_target": string }; Returns: Json
                           },
"crm_phone_due_reminders":
{ Args: { "p_limit": number }; Returns: {
              "lead_id": string,"needs_call_log_at": string,"taken_by_phone": string
            }[]
                           },
"crm_phone_finish_dial":
{ Args: { "p_alert_call_id": string,"p_dial_call_sid": string,"p_duration": number,"p_parent_call_sid": string,"p_result": string }; Returns: Json
                           },
"crm_phone_recording":
{ Args: { "p_alert_call_id": string,"p_call_sid": string,"p_duration": number,"p_recording_sid": string }; Returns: Json
                           },
"crm_reconcile_schedule":
{ Args: { "p_agreement_id": string,"p_today"?: string }; Returns: string
                           },
"crm_reconcile_schedules":
{ Args: { "p_today"?: string }; Returns: number
                           },
"crm_replace_job_items":
{ Args: { "p_booking_id": string,"p_expected_updated_at": string,"p_items": Json,"p_operation_id": string }; Returns: Json
                           },
"crm_schedule_dates":
{ Args: { "p_definition": Json,"p_from": string,"p_through": string }; Returns: string[]
                           },
"crm_schedule_first_move_conflict":
{ Args: { "p_agreement_id": string,"p_from": string,"p_through"?: string }; Returns: string
                           },
"crm_schedule_has_actual_visit":
{ Args: { "p_agreement_id": string,"p_ignore_id"?: string,"p_on": string }; Returns: boolean
                           },
"crm_schedule_slots":
{ Args: { "p_agreement_id": string,"p_from": string,"p_through": string }; Returns: {
              "cadence_on": string,"revision_id": string
            }[]
                           },
"crm_shift_agreement":
{ Args: { "p_booking_id": string,"p_date": string,"p_expected_updated_at": string,"p_operation_id": string,"p_time": string }; Returns: Json
                           },
"crm_short_code":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"crm_start_agreement":
{ Args: { "p_booking_id": string,"p_config": Json,"p_expected_updated_at": string,"p_operation_id": string }; Returns: Json
                           },
"crm_validate_items":
{ Args: { "p_items": Json }; Returns: number
                           },
"crm_validate_schedule":
{ Args: { "p_definition": Json }; Returns: boolean
                           },
"crm_write_schedule_revision":
{ Args: { "p_agreement_id": string,"p_definition": Json,"p_from": string,"p_items": Json,"p_time": string }; Returns: string
                           },
"record_intake":
{ Args: { "p_booking"?: Json,"p_existing_lead"?: string,"p_hash": string,"p_lead": Json,"p_source": string,"p_submission": string }; Returns: Json
                           },
"record_intake_v2":
{ Args: { "p_booking": Json,"p_existing_lead": string,"p_hash": string,"p_lead": Json,"p_recipients": (string)[],"p_source": string,"p_submission": string }; Returns: Json
                           },
"record_intake_v3":
{ Args: { "p_booking": Json,"p_existing_lead": string,"p_hash": string,"p_lead": Json,"p_recipients": (string)[],"p_source": string,"p_submission": string }; Returns: Json
                           },
"record_job_payment":
{ Args: { "p_amount": number,"p_booking_id": string,"p_method": string,"p_operation_id": string,"p_paid_on": string,"p_provenance": string }; Returns: string
                           },
"update_lead_workflow":
{ Args: { "p_activity": Json,"p_actor_email": string,"p_expected_updated_at": string,"p_lead_id": string,"p_patch": Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            
          }
        }
} as const
