import { SETTINGS, type SettingKey } from "@/lib/settings";
import { SettingButton } from "./setting-forms";
import styles from "./admin.module.css";

/**
 * The notice at the top of /admin: every setting whose saved value hides a value set in the server's environment, each
 * with the action that removes the saved value so the server's applies. Renders nothing when there are none.
 */
export function ShadowedNotice({ keys }: { keys: SettingKey[] }) {
  if (!keys.length) return null;
  return (
    <section className={styles.shadowed} role="alert" aria-labelledby="shadowed-title">
      <h2 id="shadowed-title" className={styles.cardTitle}>A value saved here is hiding your server&apos;s value</h2>
      <p className={styles.help}>A value saved on this page wins over the server&apos;s environment. If you set these on the server later, for example to rotate a key or lower a limit, the server&apos;s value is not in use.</p>
      <ul className={styles.shadowedList}>
        {keys.map((key) => (
          <li key={key} className={styles.shadowedItem}>
            <span>{SETTINGS[key].label} <code className={styles.code}>{SETTINGS[key].env}</code></span>
            <SettingButton settingKey={key} kind="clear" label="Use the server's value" />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The two choices for a value saved before v0.8: make it win, or remove it. */
export function LegacyChoice({ settingKey }: { settingKey: SettingKey }) {
  return (
    <span className={styles.shadowedActions}>
      <SettingButton settingKey={settingKey} kind="keep" label="Use the saved value" variant="secondary" />
      <SettingButton settingKey={settingKey} kind="clear" label="Remove the saved value" />
    </span>
  );
}

/**
 * The notice at the top of /admin after an upgrade: every value saved before v0.8, when the server's environment won,
 * that the server's value still holds back. Each has both choices. Renders nothing when there are none.
 */
export function HeldBackNotice({ keys }: { keys: SettingKey[] }) {
  if (!keys.length) return null;
  return (
    <section className={styles.shadowed} role="alert" aria-labelledby="held-back-title">
      <h2 id="held-back-title" className={styles.cardTitle}>Your server&apos;s value is still in use for these</h2>
      <p className={styles.help}>These were saved here before this version, when the server&apos;s environment won. So nothing changes on upgrade, the server&apos;s value stays in use until you choose. Use the saved value to make it win, or remove it.</p>
      <ul className={styles.shadowedList}>
        {keys.map((key) => (
          <li key={key} className={styles.shadowedItem}>
            <span>{SETTINGS[key].label} <code className={styles.code}>{SETTINGS[key].env}</code></span>
            <LegacyChoice settingKey={key} />
          </li>
        ))}
      </ul>
    </section>
  );
}
