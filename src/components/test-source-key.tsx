"use client";
import { useState, useTransition } from "react";
import { testExaKey, testSupadataKey } from "@/app/admin/actions";
import { Button } from "@/registry/components/button/button";

const TESTS = {
  supadata_api_key: { run: testSupadataKey, note: "One native-caption request. May use one Supadata credit." },
  exa_api_key: { run: testExaKey, note: "One small search. May use one Exa credit." },
} as const;

/** The Test key button under a source key in /admin: one real request, with the plain reason when it fails. */
export function TestSourceKey({ setting }: { setting: keyof typeof TESTS }) {
  const [pending, start] = useTransition(); const [message, setMessage] = useState("");
  return <div><Button size="sm" variant="secondary" disabled={pending} onClick={() => start(async () => setMessage((await TESTS[setting].run()).message))}>{pending ? "Testing…" : "Test key"}</Button><p>{TESTS[setting].note}</p>{message && <p role="status">{message}</p>}</div>;
}
