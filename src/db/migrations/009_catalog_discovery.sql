-- Shared catalog of AI tools, keyed by the same slug tool requests use (see toolKeyFor).
-- Identity and matching fields are seeded here; the vendor-review fields stay NULL ("not yet
-- reviewed") until an operator imports verified facts with `npm run catalog:import`.
CREATE TABLE ai_tool_catalog (
  key text PRIMARY KEY CHECK (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text NOT NULL,
  vendor text NOT NULL,
  category text NOT NULL,
  website text NOT NULL,
  match_domains text[] NOT NULL DEFAULT '{}',
  match_keywords text[] NOT NULL DEFAULT '{}',
  trains_on_customer_data text CHECK (trains_on_customer_data IN ('no', 'yes', 'opt_out', 'plan_dependent')),
  data_retention text,
  data_residency text,
  certifications text[],
  enterprise_controls text,
  notes text,
  source_url text,
  reviewed_at date,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO ai_tool_catalog (key, name, vendor, category, website, match_domains, match_keywords) VALUES
  ('chatgpt', 'ChatGPT', 'OpenAI', 'Assistant', 'https://chatgpt.com', '{chatgpt.com,openai.com}', '{openai,chatgpt}'),
  ('claude', 'Claude', 'Anthropic', 'Assistant', 'https://claude.ai', '{claude.ai,anthropic.com}', '{anthropic,claude.ai}'),
  ('gemini', 'Gemini', 'Google', 'Assistant', 'https://gemini.google.com', '{gemini.google.com}', '{gemini}'),
  ('microsoft-copilot', 'Microsoft Copilot', 'Microsoft', 'Assistant', 'https://copilot.microsoft.com', '{copilot.microsoft.com}', '{microsoft copilot,copilot pro,m365 copilot}'),
  ('github-copilot', 'GitHub Copilot', 'GitHub', 'Coding', 'https://github.com/features/copilot', '{copilot.github.com}', '{github copilot}'),
  ('cursor', 'Cursor', 'Anysphere', 'Coding', 'https://cursor.com', '{cursor.com,cursor.sh}', '{cursor ai,anysphere}'),
  ('perplexity', 'Perplexity', 'Perplexity AI', 'Search', 'https://www.perplexity.ai', '{perplexity.ai}', '{perplexity}'),
  ('midjourney', 'Midjourney', 'Midjourney', 'Image generation', 'https://www.midjourney.com', '{midjourney.com}', '{midjourney}'),
  ('grammarly', 'Grammarly', 'Grammarly', 'Writing', 'https://www.grammarly.com', '{grammarly.com}', '{grammarly}'),
  ('jasper', 'Jasper', 'Jasper AI', 'Writing', 'https://www.jasper.ai', '{jasper.ai}', '{jasper ai}'),
  ('deepl', 'DeepL', 'DeepL', 'Translation', 'https://www.deepl.com', '{deepl.com}', '{deepl}'),
  ('otter-ai', 'Otter.ai', 'Otter.ai', 'Meeting notes', 'https://otter.ai', '{otter.ai}', '{otter.ai,otter ai}'),
  ('fireflies-ai', 'Fireflies.ai', 'Fireflies.ai', 'Meeting notes', 'https://fireflies.ai', '{fireflies.ai}', '{fireflies}'),
  ('elevenlabs', 'ElevenLabs', 'ElevenLabs', 'Voice', 'https://elevenlabs.io', '{elevenlabs.io}', '{elevenlabs}'),
  ('mistral', 'Mistral Le Chat', 'Mistral AI', 'Assistant', 'https://chat.mistral.ai', '{mistral.ai}', '{mistral ai}');

-- AI tools seen in imported sign-in grants or expense data, one row per organization and tool.
CREATE TYPE discovery_status AS ENUM ('new', 'registered', 'ignored');
CREATE TABLE discovered_tools (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  tool_key text NOT NULL,
  name text NOT NULL,
  recognized boolean NOT NULL,
  sources text[] NOT NULL DEFAULT '{}',
  users text[] NOT NULL DEFAULT '{}',
  event_count integer NOT NULL DEFAULT 0,
  spend_cents bigint NOT NULL DEFAULT 0,
  first_seen date,
  last_seen date,
  status discovery_status NOT NULL DEFAULT 'new',
  ai_system_id uuid REFERENCES ai_systems(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, tool_key)
);
