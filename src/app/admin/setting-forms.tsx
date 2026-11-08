"use client";

import { useActionState, useEffect, type ReactNode } from "react";
import { Button } from "@/registry/components/button/button";
import { useToastStack } from "@/registry/components/toast-stack/toast-stack";
import { clearAdminSetting, keepAdminSetting, saveAdminSetting, type AdminResult } from "./actions";
import styles from "./admin.module.css";

/**
 * Says what a settings change did: a success becomes a short message in the corner, a problem stays as an alert next
 * to the field that caused it. The page never reloads to say it, so the person stays on the same tab and place.
 */
function useResult(state: AdminResult | null): string | null {
  const { toast } = useToastStack();
  useEffect(() => {
    if (state?.ok) toast({ type: "success", title: state.message });
  }, [state, toast]);
  return state && !state.ok ? state.message : null;
}

/** One setting's own Save form. The field is passed in, since secrets and plain values use different inputs. */
export function SettingSaveForm({ settingKey, children }: { settingKey: string; children: ReactNode }) {
  const [state, action, pending] = useActionState(saveAdminSetting, null);
  const problem = useResult(state);
  return (
    <>
      <form action={action} className={styles.field}>
        <input type="hidden" name="key" value={settingKey} />
        {children}
        <Button type="submit" variant="primary" size="md" loading={pending}>{pending ? "Saving" : "Save"}</Button>
      </form>
      {problem ? <p className={styles.error} role="alert">{problem}</p> : null}
    </>
  );
}

const ACTIONS = { clear: clearAdminSetting, keep: keepAdminSetting };

/** A one-click change to a saved value: remove it, or choose it over the server's. */
export function SettingButton({ settingKey, kind, label, variant = "ghost" }: { settingKey: string; kind: keyof typeof ACTIONS; label: string; variant?: "ghost" | "secondary" }) {
  const [state, action, pending] = useActionState(ACTIONS[kind], null);
  const problem = useResult(state);
  return (
    <form action={action}>
      <input type="hidden" name="key" value={settingKey} />
      <Button type="submit" variant={variant} size="sm" loading={pending}>{label}</Button>
      {problem ? <p className={styles.error} role="alert">{problem}</p> : null}
    </form>
  );
}
