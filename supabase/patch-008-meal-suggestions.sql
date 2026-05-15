-- Husholdningspilot patch 008: meal suggestions
-- This patch intentionally creates no tables.
-- The meals module reads existing products and inventory_items.
-- It is safe to run this file in Supabase SQL Editor.
select 'patch-008-meal-suggestions: no database changes required' as status;
