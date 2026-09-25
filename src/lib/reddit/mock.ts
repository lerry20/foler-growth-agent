import { MOCK_CONVERSATIONS } from "./mockData";
import type {
  CreateCommentInput,
  CreateCommentResult,
  ProviderCapabilities,
  RedditComment,
  RedditConversation,
  RedditPost,
  RedditProvider,
  RedditUser,
  SearchOptions,
} from "./types";
import { RedditProviderError } from "./types";

const clone = <T>(v: T): T => structuredClone(v);

export class MockProvider implements RedditProvider {
  readonly name = "mock" as const;
  readonly capabilities: ProviderCapabilities = {
    search: true,
    readConversation: true,
    createComment: true,
    monitorReplies: true,
  };

  private data: RedditConversation[] = clone(MOCK_CONVERSATIONS);

  async searchPosts(query: string, options?: SearchOptions): Promise<RedditPost[]> {
    const q = query.toLowerCase();
    const terms = q.split(/\s+/).filter((t) => t.length > 3);
    let posts = this.data.map((c) => c.post);
    if (options?.subreddits?.length) {
      posts = posts.filter((p) => options.subreddits!.map((s) => s.toLowerCase()).includes(p.subreddit.toLowerCase()));
    }
    posts = posts.filter((p) => {
      const text = `${p.title} ${p.body}`.toLowerCase();
      return terms.some((t) => text.includes(t));
    });
    if (options?.sort !== "relevance") posts = [...posts].sort((a, b) => +b.createdAt - +a.createdAt);
    return clone(posts.slice(0, options?.limit ?? 10));
  }

  async getPost(postId: string): Promise<RedditPost> {
    const found = this.data.find((c) => c.post.id === postId);
    if (!found) throw new RedditProviderError(`post ${postId} not found`, "NOT_FOUND");
    return clone(found.post);
  }

  async getComments(postId: string): Promise<RedditComment[]> {
    const found = this.data.find((c) => c.post.id === postId);
    if (!found) throw new RedditProviderError(`post ${postId} not found`, "NOT_FOUND");
    return clone(found.comments);
  }

  async getUser(username: string): Promise<RedditUser> {
    return { username, profileUrl: `https://www.reddit.com/user/${username}/`, accountAgeDays: 400, karma: 1200 };
  }

  async getConversation(postId: string): Promise<RedditConversation> {
    const found = this.data.find((c) => c.post.id === postId);
    if (!found) throw new RedditProviderError(`post ${postId} not found`, "NOT_FOUND");
    return clone(found);
  }

  async createComment(input: CreateCommentInput): Promise<CreateCommentResult> {
    const postId = input.parentKind === "post" ? input.parentId : this.findPostForComment(input.parentId);
    if (!postId) throw new RedditProviderError(`parent ${input.parentId} not found`, "NOT_FOUND");
    const convo = this.data.find((c) => c.post.id === postId)!;
    const id = `mockreply${Math.random().toString(36).slice(2, 10)}`;
    const comment: RedditComment = {
      id,
      postId,
      parentId: input.parentKind === "comment" ? input.parentId : null,
      subreddit: convo.post.subreddit,
      author: "mock_foler_founder",
      body: input.text,
      url: `${convo.post.url}#${id}`,
      createdAt: new Date(),
    };
    convo.comments.push(comment);
    return { id, url: comment.url };
  }

  async getReplies(postId: string, commentId: string | null): Promise<RedditComment[]> {
    const found = this.data.find((c) => c.post.id === postId);
    if (!found) throw new RedditProviderError(`post ${postId} not found`, "NOT_FOUND");
    const parent = commentId ?? null;
    return clone(found.comments.filter((c) => c.parentId === parent));
  }

  private findPostForComment(commentId: string): string | null {
    for (const c of this.data) if (c.comments.some((cm) => cm.id === commentId)) return c.post.id;
    return null;
  }
}
