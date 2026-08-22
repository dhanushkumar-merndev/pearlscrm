"use client";

import { useState, useTransition } from "react";
import { MessageSquare, Send } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { formatTimestamp } from "@/lib/dates";
import { ROLE_LABELS } from "@/lib/permissions";
import { addReviewComment } from "@/server/actions/review-comments";
import type { CaseReviewCommentWithAuthor } from "@/lib/types";

/**
 * Discussion on the expert review.
 *
 * The assessment above stays single-authored — only an administrator writes it.
 * This is where the operating surgeon says they read the case differently, on
 * the record, attributed and timestamped, attached to the case rather than sent
 * through a channel the case knows nothing about.
 *
 * Append-only: the database refuses updates and deletes. A clinical
 * disagreement that can be quietly removed is worth less than one that cannot,
 * so the UI offers no edit and no delete.
 */
export function ReviewDiscussion({
  caseId,
  initialComments,
  canComment,
  currentUserId,
  archived,
}: {
  caseId: string;
  initialComments: CaseReviewCommentWithAuthor[];
  canComment: boolean;
  currentUserId: string;
  archived: boolean;
}) {
  const [comments, setComments] = useState(initialComments);
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();

  const send = () => {
    startTransition(async () => {
      const result = await addReviewComment({ caseId, body });

      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }

      setComments(result.data.comments);
      setBody("");
      toast.success("Comment added");
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="size-4" aria-hidden />
          Discussion
          {comments.length > 0 ? (
            <span className="text-muted-foreground text-sm font-normal tabular-nums">
              ({comments.length})
            </span>
          ) : null}
        </CardTitle>
        <CardDescription>
          Questions or disagreement about the assessment. Comments are permanent and attributed —
          they cannot be edited or deleted.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {comments.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No comments yet.
            {canComment
              ? " If you read this case differently, say so here."
              : ""}
          </p>
        ) : (
          <ol className="space-y-4">
            {comments.map((comment) => (
              <li key={comment.id} className="border-border border-l-2 pl-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-sm font-medium">
                    {comment.author_id === currentUserId ? "You" : comment.author_name}
                  </span>
                  {comment.author_role ? (
                    <Badge variant="outline" className="text-muted-foreground font-normal">
                      {ROLE_LABELS[comment.author_role]}
                    </Badge>
                  ) : null}
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {formatTimestamp(comment.created_at)}
                  </span>
                </div>
                {/* Paragraphing the author typed is preserved. */}
                <p className="mt-1 text-sm leading-relaxed whitespace-pre-wrap">{comment.body}</p>
              </li>
            ))}
          </ol>
        )}

        {canComment && !archived ? (
          <div className="space-y-2">
            <Textarea
              rows={3}
              value={body}
              maxLength={4000}
              placeholder="Add a comment on the final assessment"
              aria-label="Comment on the expert review"
              onChange={(event) => setBody(event.target.value)}
            />
            <Button onClick={send} disabled={pending || body.trim() === ""}>
              {pending ? <Spinner /> : <Send aria-hidden />}
              Send comment
            </Button>
          </div>
        ) : archived ? (
          <p className="text-muted-foreground text-sm">
            This case is archived. The discussion is read-only.
          </p>
        ) : (
          <p className="text-muted-foreground text-sm">
            This account can read the discussion but not add to it.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
