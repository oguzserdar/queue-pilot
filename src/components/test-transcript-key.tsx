"use client";
import { useState, useTransition } from "react";
import { testSupadataKey } from "@/app/admin/actions";
import { Button } from "@/registry/components/button/button";
export function TestTranscriptKey() {
  const [pending, start] = useTransition(); const [message, setMessage] = useState("");
  return <div><Button size="sm" variant="secondary" disabled={pending} onClick={() => start(async () => setMessage((await testSupadataKey()).message))}>{pending ? "Testing…" : "Test key"}</Button><p>One native-caption request. May use one Supadata credit.</p>{message && <p role="status">{message}</p>}</div>;
}
