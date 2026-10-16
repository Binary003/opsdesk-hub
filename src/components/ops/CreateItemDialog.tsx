import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { createItem } from "@/api/client";
import type { ItemType, Priority } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDirectory, useMe } from "@/lib/queries";
import { can } from "@/lib/workflow";
import { newKey } from "@/lib/session";
import { Gate, PRIORITY_LABEL } from "./bits";

export function CreateItemDialog() {
  const dir = useDirectory();
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const allowedTeams = dir.teams.filter((t) => can.edit(me.roleFor(t.id)));
  const [open, setOpen] = useState(false);
  const [idemKey, setIdemKey] = useState(newKey);
  const [teamId, setTeamId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<ItemType>("request");
  const [priority, setPriority] = useState<Priority>("medium");
  const [dueAt, setDueAt] = useState("");
  const [requiresApproval, setRequiresApproval] = useState(false);
  const team = teamId || allowedTeams[0]?.id || "";

  const m = useMutation({
    mutationFn: () =>
      createItem(
        me.user.id,
        {
          teamId: team,
          title: title.trim(),
          description: description.trim(),
          type,
          priority,
          dueAt: dueAt ? new Date(dueAt).toISOString() : null,
          requiresApproval,
          assigneeId: null,
        },
        { idempotencyKey: idemKey, expectedVersion: 0 },
      ),
    onSuccess: (item) => {
      qc.invalidateQueries({ queryKey: ["items"] });
      qc.invalidateQueries({ queryKey: ["attention"] });
      setOpen(false);
      setTitle("");
      setDescription("");
      setDueAt("");
      setRequiresApproval(false);
      setIdemKey(newKey());
      toast.success(`Created ${item.key}`);
      navigate({ to: "/items/$key", params: { key: item.key } });
    },
    onError: (e) => toast.error(e.message),
  });

  const blocked = allowedTeams.length === 0 ? "Viewers can't create items" : null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Gate reason={blocked}>
        <DialogTrigger asChild>
          <Button size="sm" disabled={!!blocked}>
            <Plus /> New item
          </Button>
        </DialogTrigger>
      </Gate>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New work item</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) m.mutate();
          }}
        >
          <div className="grid grid-cols-3 gap-3">
            <Field label="Team">
              <Select value={team} onValueChange={setTeamId}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {allowedTeams.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Type">
              <Select value={type} onValueChange={(v) => setType(v as ItemType)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(["incident", "request", "task", "change"] as const).map((t) => (
                    <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Priority">
              <Select value={priority} onValueChange={(v) => setPriority(v as Priority)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(["low", "medium", "high", "urgent"] as const).map((p) => (
                    <SelectItem key={p} value={p}>{PRIORITY_LABEL[p]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="Title">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
          </Field>
          <Field label="Description">
            <Textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 items-end gap-3">
            <Field label="Due date">
              <Input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
            </Field>
            <label className="flex h-9 items-center gap-2 text-sm">
              <Switch checked={requiresApproval} onCheckedChange={setRequiresApproval} />
              Requires approval
            </label>
          </div>
          <DialogFooter>
            <Button type="submit" size="sm" disabled={!title.trim() || m.isPending}>
              {m.isPending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
