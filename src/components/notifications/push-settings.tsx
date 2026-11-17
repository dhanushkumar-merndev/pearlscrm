"use client";

import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { BellRing, X } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  currentPushState,
  disablePush,
  enablePush,
  refreshPushToken,
  type PushState,
} from "@/lib/push/client";

const PROMPT_DISMISSED_KEY = "pearl.push.prompt-dismissed";

// Push state lives in the browser (permission + stored token). Read it as an
// external store: nothing on the server, the real value once hydrated.
const noSubscribe = () => () => {};
function useBrowserPushState(): PushState | null {
  return useSyncExternalStore(noSubscribe, currentPushState, () => null);
}

function promptWanted(): boolean {
  if (currentPushState() !== "disabled" || Notification.permission !== "default") return false;
  try {
    return window.localStorage.getItem(PROMPT_DISMISSED_KEY) !== "1";
  } catch {
    return true;
  }
}

function describe(state: PushState): string {
  switch (state) {
    case "enabled":
      return "This browser shows surgery reminders and other notifications even when the app is closed.";
    case "denied":
      return "Notifications are blocked for this site. Allow them in the browser's site settings, then turn this on.";
    case "unsupported":
      return "This browser cannot receive push notifications. The bell in the app still shows everything.";
    default:
      return "Get surgery reminders and approvals on this device, even when the app is closed.";
  }
}

/** Profile page card: turn browser push on or off for this device. */
export function PushSettingsCard() {
  const browserState = useBrowserPushState();
  const [changed, setState] = useState<PushState | null>(null);
  const [pending, startTransition] = useTransition();
  const state = changed ?? browserState;

  if (state === null || state === "unconfigured") return null;

  const toggle = (on: boolean) =>
    startTransition(async () => {
      try {
        const next = on ? await enablePush() : await disablePush();
        setState(next);
        if (on && next === "enabled") toast.success("Notifications are on for this browser.");
        if (on && next === "denied") toast.error("Notifications are blocked in this browser's settings.");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not change notifications.");
        setState(currentPushState());
      }
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BellRing className="size-4" aria-hidden />
          Notifications on this device
        </CardTitle>
        <CardDescription>{describe(state)}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-3">
          <Switch
            id="push-toggle"
            checked={state === "enabled"}
            disabled={pending || state === "unsupported" || state === "denied"}
            onCheckedChange={toggle}
          />
          <Label htmlFor="push-toggle">{state === "enabled" ? "On" : "Off"}</Label>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * One-time prompt in the app shell. Shown only while the browser has not been
 * asked yet; dismissing it is remembered per browser. Also keeps an enabled
 * browser's token fresh.
 */
export function PushPrompt() {
  const wanted = useSyncExternalStore(noSubscribe, promptWanted, () => false);
  const [closed, setClosed] = useState(false);
  const setVisible = (value: boolean) => setClosed(!value);
  const visible = wanted && !closed;
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (currentPushState() === "enabled") void refreshPushToken();
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    try {
      window.localStorage.setItem(PROMPT_DISMISSED_KEY, "1");
    } catch {
      // Not remembered in private mode; harmless.
    }
    setVisible(false);
  };

  return (
    <Alert>
      <BellRing aria-hidden />
      <AlertTitle>Turn on notifications for surgery reminders?</AlertTitle>
      <AlertDescription>
        <p>You will be reminded the evening before and the morning of each surgery you are part of.</p>
        <div className="mt-2 flex gap-2">
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                try {
                  const next = await enablePush();
                  if (next === "enabled") toast.success("Notifications are on for this browser.");
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Could not turn on notifications.");
                }
                dismiss();
              })
            }
          >
            Turn on
          </Button>
          <Button size="sm" variant="ghost" onClick={dismiss}>
            <X aria-hidden />
            Not now
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
