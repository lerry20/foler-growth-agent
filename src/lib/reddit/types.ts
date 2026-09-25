// Reddit provider abstraction. The rest of the app only depends on this file.

export type RedditProviderName = "mock" | "public_web" | "official_api";

export interface RedditPost {
  id: string; // reddit fullname without prefix, e.g. "1abc23"
  subreddit: string; // without "r/"
  author: string; // without "u/"
  title: string;
  body: string;
  url: string; // canonical https://www.reddit.com/r/.../comments/<id>/...
  createdAt: Date;
  score?: number;
  numComments?: number;
}

export interface RedditComment {
  id: string;
  postId: string;
  parentId: string | null; // null => top-level comment on the post
  subreddit: string;
  author: string;
  body: string;
  url: string;
  createdAt: Date;
  score?: number;
}

export interface RedditUser {
  username: string;
  profileUrl: string;
  accountAgeDays?: number;
  karma?: number;
}

export interface RedditConversation {
  post: RedditPost;
  comments: RedditComment[];
}

export interface SearchOptions {
  subreddits?: string[]; // empty => site-wide
  limit?: number;
  sort?: "new" | "relevance";
  timeWindow?: "day" | "week" | "month" | "year" | "all";
}

export interface ThreadRef {
  subreddit?: string;
}

export interface CreateCommentInput {
  parentId: string; // post id or comment id
  parentKind: "post" | "comment";
  text: string;
}

export interface CreateCommentResult {
  id: string;
  url: string;
}

export class RedditProviderError extends Error {
  constructor(
    message: string,
    public readonly kind: "RATE_LIMITED" | "FORBIDDEN" | "NOT_FOUND" | "UNSUPPORTED" | "NETWORK" | "PARSE",
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "RedditProviderError";
  }
}

export interface ProviderCapabilities {
  search: boolean;
  readConversation: boolean;
  createComment: boolean; // false => manual execution mode
  monitorReplies: boolean; // false => manual refresh/import mode
}

export interface RedditProvider {
  readonly name: RedditProviderName;
  readonly capabilities: ProviderCapabilities;
  searchPosts(query: string, options?: SearchOptions): Promise<RedditPost[]>;
  /** Newest posts of one subreddit, most recent first. One request for up to 100 posts. */
  listNewPosts?(subreddit: string, limit?: number): Promise<RedditPost[]>;
  getPost(postId: string, ref?: ThreadRef): Promise<RedditPost>;
  getComments(postId: string, ref?: ThreadRef): Promise<RedditComment[]>;
  getUser(username: string): Promise<RedditUser>;
  getConversation(postId: string, ref?: ThreadRef): Promise<RedditConversation>;
  /** Throws RedditProviderError("UNSUPPORTED") when capabilities.createComment is false. */
  createComment(input: CreateCommentInput): Promise<CreateCommentResult>;
  /** Replies to one of our comments (or to the post if commentId is null). */
  getReplies(postId: string, commentId: string | null, ref?: ThreadRef): Promise<RedditComment[]>;
}
