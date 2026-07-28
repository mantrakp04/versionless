import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Badge } from "@versionless/ui/components/badge";
import { Button } from "@versionless/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@versionless/ui/components/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@versionless/ui/components/dialog";
import { Input } from "@versionless/ui/components/input";
import { Label } from "@versionless/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@versionless/ui/components/select";
import { Separator } from "@versionless/ui/components/separator";
import { TableCell, TableHead } from "@versionless/ui/components/table";
import { Copy, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { NoProjectCard } from "@/components/insights/no-project-card";
import { DashboardTable } from "@/components/dashboard-table";
import { useSelectedTeam } from "@/hooks/use-selected-team";
import { clientErrorMessage } from "@/utils/client-error";

export const Route = createFileRoute("/keys")({
  component: KeysPage,
});

const EXPIRY_OPTIONS = [
  { value: "never", label: "Never expires", days: null },
  { value: "30", label: "30 days", days: 30 },
  { value: "90", label: "90 days", days: 90 },
  { value: "365", label: "1 year", days: 365 },
] as const;

const KEY_GRID_COLUMNS =
  "minmax(10rem, 1.2fr) minmax(6rem, .7fr) minmax(7rem, .75fr) minmax(7rem, .75fr) .6fr minmax(4rem, .5fr)";

function copy(text: string, what: string) {
  void navigator.clipboard.writeText(text).then(
    () => toast.success(`${what} copied`),
    () => toast.error("Copy failed"),
  );
}

function KeysPage() {
  const { user, selectedTeam } = useSelectedTeam();

  return (
    <div className="container mx-auto max-w-5xl space-y-6 px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-heading text-xl font-medium">API keys</h1>
        </div>
      </div>

      {!selectedTeam ? (
        <NoProjectCard />
      ) : (
        <TeamKeys key={selectedTeam.id} team={selectedTeam} user={user} />
      )}
    </div>
  );
}

function TeamKeys({
  team,
  user,
}: {
  team: NonNullable<ReturnType<typeof useSelectedTeam>["selectedTeam"]>;
  user: ReturnType<typeof useSelectedTeam>["user"];
}) {
  const keys = team.useApiKeys();
  const canManage = user.usePermission(team, "$manage_api_keys") !== null;

  const [description, setDescription] = useState("");
  const [expiry, setExpiry] = useState<string>("never");
  const [creating, setCreating] = useState(false);
  // The full secret exists only in this state, only right after creation —
  // Hexclave never returns it again.
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);

  const create = async () => {
    const option = EXPIRY_OPTIONS.find((o) => o.value === expiry);
    setCreating(true);
    try {
      const created = await team.createApiKey({
        description: description.trim() || "versionless SDK",
        expiresAt: option?.days
          ? new Date(Date.now() + option.days * 24 * 60 * 60 * 1000)
          : null,
      });
      setCreatedSecret(created.value);
      setDescription("");
    } catch (error) {
      toast.error(
        clientErrorMessage(
          error,
          "We could not create the key. Please try again.",
        ),
      );
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (id: string) => {
    const target = keys.find((k) => k.id === id);
    if (!target) return;
    try {
      await target.revoke();
      toast.success("Key revoked");
    } catch (error) {
      toast.error(
        clientErrorMessage(
          error,
          "We could not revoke the key. Please try again.",
        ),
      );
    }
  };

  return (
    <>
      <Card>
        {canManage ? (
          <>
            <CardHeader>
              <CardTitle>Create key</CardTitle>
            </CardHeader>
            <CardContent className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_auto]">
              <div className="min-w-56 flex-1 space-y-1.5">
                <Label htmlFor="key-description">Description</Label>
                <Input
                  id="key-description"
                  placeholder="production server"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="key-expiry">Expiry</Label>
                <div>
                  <Select
                    value={expiry}
                    onValueChange={(value) => setExpiry(value ?? "never")}
                  >
                    <SelectTrigger id="key-expiry" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EXPIRY_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button
                className="w-full sm:w-auto"
                onClick={() => void create()}
                disabled={creating}
              >
                {creating ? "Creating…" : "Create key"}
              </Button>
            </CardContent>
          </>
        ) : (
          <CardContent>
            <p className="text-xs text-muted-foreground">
              You need the admin role in this team to create or revoke keys.
            </p>
          </CardContent>
        )}

        <Separator />

        <CardHeader>
          <CardTitle>Keys</CardTitle>
        </CardHeader>
        <CardContent>
          <DashboardTable
            items={keys}
            getItemKey={(key) => key.id}
            gridTemplateColumns={canManage ? KEY_GRID_COLUMNS : undefined}
            emptyState="No keys yet."
            renderHeader={() => (
              <>
                <TableHead>Description</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Status</TableHead>
                {canManage ? <TableHead /> : null}
              </>
            )}
            renderRow={(key) => (
              <>
                <TableCell>{key.description}</TableCell>
                <TableCell className="font-mono text-xs">
                  ••••{key.value.lastFour}
                </TableCell>
                <TableCell className="text-xs">
                  {key.createdAt.toLocaleDateString()}
                </TableCell>
                <TableCell className="text-xs">
                  {key.expiresAt ? key.expiresAt.toLocaleDateString() : "never"}
                </TableCell>
                <TableCell>
                  {key.isValid() ? (
                    <Badge variant="outline">active</Badge>
                  ) : (
                    <Badge variant="destructive">
                      {key.whyInvalid() ?? "invalid"}
                    </Badge>
                  )}
                </TableCell>
                {canManage ? (
                  <TableCell className="text-right">
                    {key.isValid() ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void revoke(key.id)}
                      >
                        Revoke
                      </Button>
                    ) : null}
                  </TableCell>
                ) : null}
              </>
            )}
          />
        </CardContent>
      </Card>

      <Dialog
        open={createdSecret !== null}
        onOpenChange={(open) => {
          if (!open) setCreatedSecret(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Key created</DialogTitle>
          </DialogHeader>
          <div className="flex gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-amber-950 dark:text-amber-200">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <DialogDescription className="text-current!">
              The full key is shown exactly once — store it in your server env.
            </DialogDescription>
          </div>
          <div className="flex min-w-0 items-stretch overflow-hidden rounded-lg border bg-muted/40">
            <code className="min-w-0 flex-1 overflow-x-auto px-3 py-2.5 font-mono text-xs whitespace-nowrap">
              {createdSecret ?? ""}
            </code>
            <Button
              className="h-auto w-11 shrink-0 rounded-none border-0 border-l bg-background"
              variant="ghost"
              aria-label="Copy API key"
              onClick={() => createdSecret && copy(createdSecret, "API key")}
            >
              <Copy className="size-4" />
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setCreatedSecret(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
