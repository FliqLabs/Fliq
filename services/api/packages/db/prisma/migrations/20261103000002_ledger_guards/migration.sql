-- Journal entries must sum to zero per asset, checked at commit so all lines can be inserted first.
CREATE FUNCTION ledger.assert_entry_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  unbalanced_asset text;
BEGIN
  SELECT asset INTO unbalanced_asset
  FROM ledger.journal_lines
  WHERE entry_id = NEW.entry_id
  GROUP BY asset
  HAVING SUM(amount) <> 0
  LIMIT 1;

  IF unbalanced_asset IS NOT NULL THEN
    RAISE EXCEPTION 'journal entry % does not sum to zero for asset %', NEW.entry_id, unbalanced_asset
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER journal_lines_balanced
AFTER INSERT ON ledger.journal_lines
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION ledger.assert_entry_balanced();

ALTER TABLE ledger.journal_lines ADD CONSTRAINT journal_lines_amount_nonzero CHECK (amount <> 0);

-- Append-only tables. The trigger also binds the table owner, which REVOKE does not.
CREATE FUNCTION public.reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '%.% is append-only', TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER journal_entries_append_only
BEFORE UPDATE OR DELETE ON ledger.journal_entries
FOR EACH ROW EXECUTE FUNCTION public.reject_mutation();

CREATE TRIGGER journal_lines_append_only
BEFORE UPDATE OR DELETE ON ledger.journal_lines
FOR EACH ROW EXECUTE FUNCTION public.reject_mutation();

CREATE TRIGGER payout_events_append_only
BEFORE UPDATE OR DELETE ON core.payout_events
FOR EACH ROW EXECUTE FUNCTION public.reject_mutation();

-- Grants for a separate application role are applied only when it exists, so the migration also runs locally.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fliq_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON ledger.journal_entries, ledger.journal_lines, core.payout_events FROM fliq_app;
  END IF;
END;
$$;
