# Buffer API Reference

> Connect Buffer to your agents, automation tools, or build something entirely new.

API Endpoint: https://api.buffer.com
Authentication: Bearer token via Authorization header

## Queries

#### account

Retrieves the authenticated user's account information

**Returns:** `Account!`

#### aggregatedPostMetrics

Aggregate normalized post metrics across a filtered post set. Useful
for yearly summaries, channel-level rollups, and BI exports without
paginating through thousands of posts.

For per-post metrics, use `posts(input)` or `post(input)` with a
`metrics { … }` selection — this query is purely for aggregation.

The result always contains a baseline trio of entries: `postCount`
(number of matched posts in the window), `reactions`, and `comments`.
Posts on networks that don't track reactions or comments contribute 0
to those totals.

Beyond the baseline, additional metric types are returned only when
every channel in the filter set supports them. A single-network filter
surfaces that network's richer metrics (e.g. impressions, reach,
engagementRate on LinkedIn); a mixed-network filter trims the extras
to those common to every network in the set.

**Returns:** `AggregatedPostMetrics!`

**Arguments:**
- `input`: `AggregatedPostMetricsInput!` - Query's input: organization, date range, optional channel and tag
filters. Date range is capped to 365 days.

#### channel

Fetches a single channel using the provided ID

**Returns:** `Channel!`

**Arguments:**
- `input`: `ChannelInput!` - Query's input.

#### channels

Fetch all channels for the organization taking into account the current's user permissions

**Returns:** `[Channel!]!`

**Arguments:**
- `input`: `ChannelsInput!` - Query's input.

#### configuration

Global, per-organization configuration: the connected `channels` the actor can
view (with per-feature authorization) plus the service-level capability
catalog (`services`). One round trip for every capability domain; clients
select only what they need.

**Status:** ⚠️ Experimental

**Returns:** `Configuration!`

**Arguments:**
- `input`: `ConfigurationInput!` - Input for the configuration query.

#### contentItem

Fetch a single content item by id. Errors if no content item with that id
exists.

This API is an early preview and can change without a deprecation period.

**Status:** ⚠️ Experimental

**Returns:** `ContentItem!`

**Arguments:**
- `input`: `ContentItemInput!` - Input for fetching a single content item.

#### contentItems

Fetch an organization's content items in the requested order, newest first
by default. Uses standard cursor pagination: pass the previous page's
`pageInfo.endCursor` as `after` to fetch the next page. Requesting more than
100 items in a single page is rejected.

This API is an early preview and can change without a deprecation period.

**Status:** ⚠️ Experimental

**Returns:** `ContentItemsConnection!`

**Arguments:**
- `after`: `String` - The cursor after which to return results. Cursors are opaque: treat
them as a black box and reset to null when the input changes, since a
cursor from a different result set produces undefined behavior.
- `first`: `Int` - The number of content items to return, up to 100.
- `input`: `ContentItemsInput!` - Input for listing content items.

#### dailyPostingLimits

Returns posting limit status for the given channels at the intended posting time.

**Returns:** `[DailyPostingLimitStatus!]!`

**Arguments:**
- `input`: `DailyPostingLimitsInput!` - Query's input.

#### ideaGroups

Retrieves idea groups based on the provided input parameters.

**Returns:** `[IdeaGroup!]!`

**Arguments:**
- `input`: `IdeaGroupsInput!` - Input for retrieving idea groups.

#### ideas

Fetch a paginated list of ideas with optional filtering

**Returns:** `IdeasConnection!`

**Arguments:**
- `after`: `String` - Cursor for pagination, marks where to start fetching from
- `first`: `Int` - Maximum number of items to return
- `input`: `IdeasInput!` - Filtering criteria for the ideas list

#### instagramAudio

Refresh metadata and preview availability for one Instagram audio asset.
Requires Facebook Login. Instagram Login channels return ChannelRefreshRequired.

**Status:** ⚠️ Experimental

**Returns:** `InstagramAudioPayload!`

**Arguments:**
- `input`: `InstagramAudioInput!` - Channel and audio asset used to refresh metadata.

#### instagramAudioCatalog

Return trending music and original sounds in a single request.
Requires Facebook Login. Instagram Login channels return ChannelRefreshRequired.

**Status:** ⚠️ Experimental

**Returns:** `InstagramAudioCatalogPayload!`

**Arguments:**
- `input`: `InstagramAudioCatalogInput!` - Channel to load trending audio for. No catalog selection is needed.

#### post

Fetches a post by PostID for the given organization: first and last can be set for forward pagination using Relay convention

**Returns:** `Post!`

**Arguments:**
- `input`: `PostInput!` - Query's input.

#### posts

Fetches posts for the given organization: first and last can be set for forward pagination using Relay convention

**Returns:** `PostsResults!`

**Arguments:**
- `after`: `String` - The cursor of the post to start fetching from
- `first`: `Int` - The number of posts to return
- `input`: `PostsInput!` - Query's input.

#### postTemplate

Fetch a single post template by ID. Returns null if not found.

**Status:** 🧪 Preview

**Returns:** `PostTemplate`

**Arguments:**
- `input`: `PostTemplateInput!` - Input for fetching a single post template.

#### postTemplates

Fetch the templates visible to the current actor for the template
library: public templates, plus internal templates from the supplied
`organizationId`, plus private templates owned by the actor's
account. The visibility scope is always pinned to the actor and the
supplied organization — the input filter can only narrow within that
scope, never widen it.

**Status:** 🧪 Preview

**Returns:** `PostTemplatesConnection!`

**Arguments:**
- `after`: `String` - The cursor after which to return results.
- `first`: `Int` - The number of templates to return.
- `input`: `PostTemplatesInput!` - Input containing the organization scope and optional filters.

#### searchInstagramAudio

Search Instagram audio for one channel.
Requires Facebook Login. Instagram Login channels return ChannelRefreshRequired.

**Status:** ⚠️ Experimental

**Returns:** `SearchInstagramAudioPayload!`

**Arguments:**
- `input`: `SearchInstagramAudioInput!` - Channel, catalog type, and search text.

#### searchInstagramAudioCatalog

Search music and original sounds in a single request.
Requires Facebook Login. Instagram Login channels return ChannelRefreshRequired.

**Status:** ⚠️ Experimental

**Returns:** `InstagramAudioCatalogPayload!`

**Arguments:**
- `input`: `SearchInstagramAudioCatalogInput!` - Channel and nonblank search text. No catalog selection is needed.

#### snippets

Returns the snippets of an organization, sorted by name. Uses
standard cursor pagination: pass the previous page's `pageInfo.endCursor`
as `after` to fetch the next page. Requesting more than 100 snippets
in a single page is rejected. A cursor whose snippet was deleted
reports a BAD_USER_INPUT error. Fetch again from the first page.

**Status:** ⚠️ Experimental

**Returns:** `SnippetsConnection!`

**Arguments:**
- `after`: `String` - The cursor after which to return results. Cursors are opaque: treat
them as a black box.
- `first`: `Int` - The number of snippets to return, from 1 to 100. Defaults to 10.
- `input`: `SnippetsInput!` - The query input.

#### tag

Fetch a single tag by id.

Resolves to null with a NOT_FOUND error when no tag has that id, and with an
UNAUTHORIZED error when the tag belongs to an organization the caller cannot
read. Both are reported in the errors array.

This API is an early preview and can change without a deprecation period.

**Status:** ⚠️ Experimental

**Returns:** `Tag`

**Arguments:**
- `input`: `TagByIdInput!` - Identifies the tag to fetch.

#### tagsV2

Fetch a page of the organization's tags, sorted by name in ascending order.
Uses standard cursor pagination: pass the previous page's `pageInfo.endCursor`
as `after` to fetch the next page. Requesting more than 100 tags in a single
page is rejected.

This API is an early preview and can change without a deprecation period.

**Status:** ⚠️ Experimental

**Returns:** `TagsConnection!`

**Arguments:**
- `after`: `String` - The cursor after which to return results. Cursors are opaque: treat them as
a black box and reset to null when the input changes, since a cursor from a
different result set produces undefined behavior.
- `first`: `Int` - The number of tags to return, up to 100.
- `input`: `TagsInput!` - Identifies the organization whose tags to list, and how to filter them.

#### trendingInstagramAudio

Return Meta trending Instagram audio for one channel.
Requires Facebook Login. Instagram Login channels return ChannelRefreshRequired.

**Status:** ⚠️ Experimental

**Returns:** `SearchInstagramAudioPayload!`

**Arguments:**
- `input`: `TrendingInstagramAudioInput!` - Channel and catalog type for Meta trending audio.

## Mutations

#### addPostToContentItem

Add a post that already exists to a content item. The mutation creates no
post. To add a new post, call createPost first.

**Status:** ⚠️ Experimental

**Returns:** `AddPostToContentItemPayload!`

**Arguments:**
- `input`: `AddPostToContentItemInput!` - Input for addPostToContentItem.

#### createContentItem

Create a content item together with all of its channel-specific post variants
in a single operation. Validation is all-or-nothing: if any variant fails
validation, no content item and no variants are created. Variants that fail
while being processed after creation are reported per channel in the failure
payload; the content item and its variants are still created in that case.

This API is an early preview and can change without a deprecation period.

**Status:** ⚠️ Experimental

**Returns:** `CreateContentItemPayload!`

**Arguments:**
- `input`: `CreateContentItemInput!` - Input for createContentItem.

#### createContentItemDraft

Create a content item holding a channel-less draft, before any channels
are selected. No network-specific validation applies to the draft content.
The draft needs text or at least one asset.

This API is an early preview and can change without a deprecation period.

**Status:** ⚠️ Experimental

**Returns:** `CreateContentItemDraftPayload!`

**Arguments:**
- `input`: `CreateContentItemDraftInput!` - Input for createContentItemDraft.

#### createIdea

Create a new idea with the given content and metadata

**Returns:** `CreateIdeaPayload!`

**Arguments:**
- `input`: `CreateIdeaInput!` - Input to create an idea

#### createPost

Create post for channel

**Returns:** `PostActionPayload!`

**Arguments:**
- `input`: `CreatePostInput!` - The mutation's input

#### createPostTemplate

Create a post template visible only to the caller (`private`) or to
the caller's organization (`internal`).

**Status:** 🧪 Preview

**Returns:** `CreatePostTemplatePayload!`

**Arguments:**
- `input`: `CreatePostTemplateInput!` - Input for creating a post template.

#### createSnippet

Creates a snippet in an organization.

**Status:** ⚠️ Experimental

**Returns:** `CreateSnippetPayload!`

**Arguments:**
- `input`: `CreateSnippetInput!` - Input for createSnippet.

#### createTag

Create a tag for an organization.

The name must be unique within the organization; a duplicate is refused with
`DuplicateError`. Creation is refused with `LimitReachedError` once the
organization already holds as many tags as its plan allows.

This API is an early preview and can change without a deprecation period.

**Status:** ⚠️ Experimental

**Returns:** `CreateTagPayload!`

**Arguments:**
- `input`: `CreateTagInput!` - Identifies the organization to create the tag in, and the name and color to
give the tag.

#### deleteContentItem

Delete a content item: the item itself and any posts created from it.
Deletion is all-or-nothing. Every post must be deletable on its own, or
nothing is deleted and every blocked post is reported at once. A post can
only be deleted while it is a draft, awaiting approval, scheduled, or
failed, so an item cannot be deleted while any of its posts is publishing
or already published. An item still holding a channel-less draft has no
posts, so nothing blocks it. An error can also be reported when a post
could not be fully processed after the deletion already took effect;
re-fetch before retrying.

Deleting a content item also deletes the team notes on the item and on its
posts. The notes are removed shortly after the item is deleted.

This API is an early preview and can change without a deprecation period.

**Status:** ⚠️ Experimental

**Returns:** `DeleteContentItemPayload!`

**Arguments:**
- `input`: `DeleteContentItemInput!` - Input for deleteContentItem.

#### deletePost

Delete a post by id.

**Returns:** `DeletePostPayload!`

**Arguments:**
- `input`: `DeletePostInput!` - Input for the deletePost mutation.

#### deletePostTemplate

Delete a post template owned by the caller (or an internal template
in the caller's organization, if the caller is an org admin/owner).

**Status:** 🧪 Preview

**Returns:** `DeletePostTemplatePayload!`

**Arguments:**
- `input`: `DeletePostTemplateInput!` - Input for deleting a post template.

#### deleteSnippet

Deletes a snippet.

**Status:** ⚠️ Experimental

**Returns:** `DeleteSnippetPayload!`

**Arguments:**
- `input`: `DeleteSnippetInput!` - Input for deleteSnippet.

#### deleteTag

Delete a tag.

The tag is removed from every post, idea and content item carrying it; those
items are otherwise untouched. A locked tag can be deleted, and deleting an
unlocked tag frees a slot for the oldest locked one. See `Tag.isLocked`.

This API is an early preview and can change without a deprecation period.

**Status:** ⚠️ Experimental

**Returns:** `DeleteTagPayload!`

**Arguments:**
- `input`: `DeleteTagInput!` - Identifies the tag to delete.

#### editPost

Edit post for channel

**Returns:** `PostActionPayload!`

**Arguments:**
- `input`: `EditPostInput!` - The mutation's input

#### movePostInQueue

Move a queued post to the top or bottom of its channel's queue. Unlike editPost, this
is a scheduling-only operation that never re-validates the post's content.

**Status:** ⚠️ Experimental

**Returns:** `MovePostInQueuePayload!`

**Arguments:**
- `input`: `MovePostInQueueInput!` - The mutation's input

#### promoteContentItemDraftToPosts

Promote a channel-less draft into channel-specific posts. One-way: once
promoted, the content item can no longer be edited as a draft. If any post
fails validation, none are created. A failure can also be reported when a
post could not be fully processed after the promotion already took effect;
re-fetch the content item to check its state before retrying.

This API is an early preview and can change without a deprecation period.

**Status:** ⚠️ Experimental

**Returns:** `PromoteContentItemDraftToPostsPayload!`

**Arguments:**
- `input`: `PromoteContentItemDraftToPostsInput!` - Input for promoteContentItemDraftToPosts.

#### removePostFromContentItem

Remove a post from a content item. The post survives on its own channel
and keeps its schedule, text, status, and tags. Only the link to the
content item goes away. To delete a post, call deletePost.

A second call with a post that belongs to no content item changes nothing,
and the mutation reports success.

**Status:** ⚠️ Experimental

**Returns:** `RemovePostFromContentItemPayload!`

**Arguments:**
- `input`: `RemovePostFromContentItemInput!` - Input for removePostFromContentItem.

#### updateContentItem

Update a content item's title or target date. Fields that are
omitted keep their current value.

This API is an early preview and can change without a deprecation period.

**Status:** ⚠️ Experimental

**Returns:** `UpdateContentItemPayload!`

**Arguments:**
- `input`: `UpdateContentItemInput!` - Input for updateContentItem.

#### updateContentItemDraft

Replace a channel-less draft's content in full, and optionally set the
content item's target date in the same write. The draft needs text or at
least one asset. Only valid while the content item is still a draft.

This API is an early preview and can change without a deprecation period.

**Status:** ⚠️ Experimental

**Returns:** `UpdateContentItemDraftPayload!`

**Arguments:**
- `input`: `UpdateContentItemDraftInput!` - Input for updateContentItemDraft.

#### updatePostTemplate

Update a post template owned by the caller (or an internal template
in the caller's organization, if the caller is an org admin/owner).

**Status:** 🧪 Preview

**Returns:** `UpdatePostTemplatePayload!`

**Arguments:**
- `input`: `UpdatePostTemplateInput!` - Input for updating a post template.

#### updateSnippet

Replaces the name and text of a snippet.

**Status:** ⚠️ Experimental

**Returns:** `UpdateSnippetPayload!`

**Arguments:**
- `input`: `UpdateSnippetInput!` - Input for updateSnippet.

#### updateTag

Update a tag's name and color.

Both values are replaced, so send the current value for the one you are not
changing. The new name must still be unique within the organization; a
duplicate is refused with `DuplicateError`.

A locked tag cannot be edited and the update is refused. See `Tag.isLocked`.

This API is an early preview and can change without a deprecation period.

**Status:** ⚠️ Experimental

**Returns:** `UpdateTagPayload!`

**Arguments:**
- `input`: `UpdateTagInput!` - Identifies the tag to update, and the name and color to set on it.

## Object Types

#### Account

Account is a representation of a Buffer user.

**Fields:**
- `id`: `ID!` - Unique identifier for the account
- `email`: `String!` - Primary email address for the account
- `backupEmail`: `String` - Backup email address for account recovery
- `avatar`: `String!` - URL to the account's avatar image
- `createdAt`: `DateTime` - Date the account was created in the Core DB. For older customers, it's possible a Publish account existed in the Publish DB for this customer before this date
- `organizations`: `[Organization!]!`
  - Arg `filter`: `OrganizationFilterInput`
- `timezone`: `String` - The account-level timezone - this is used as a default input for streaks, posting plans, and new channel channel connections.
- `name`: `String` - The account name, different from the organization name
- `preferences`: `Preferences` - The accounts preferences
- `connectedApps`: `[ConnectedApp!]` - The connected apps for the account

#### AddPostToContentItemSuccess

Successful addPostToContentItem response.

**Status:** ⚠️ Experimental

**Fields:**
- `contentItem`: `ContentItem!` - The content item after the mutation added the post.
- `post`: `Post!` - The post after the mutation added it. Its contentItemId names this content
item.

#### AggregatedPostMetrics

Aggregated post metrics across a filtered post set. Each entry in
`metrics` mirrors the shape of a `Post.metrics` entry; the total number
of matched posts is carried as a regular `PostMetric` entry with
`type: postCount`.

**Fields:**
- `metrics`: `[PostMetric!]!` - Normalized metric aggregates across the matched posts. Always includes
a baseline trio (`postCount`, `reactions`, `comments`) — posts on
networks that don't track reactions or comments contribute 0 to those
totals. Beyond the baseline, additional metric types are included only
when every channel in the filter set supports them.
- `metricsUpdatedAt`: `DateTime` - The latest `metricsUpdatedAt` across the matched posts, indicating the
freshness of the aggregate. Metrics are refreshed daily, so values can
be up to ~24h behind the source network. Null when no posts matched
the filter.

#### Annotation

Annotation representing all the entities in the text

**Fields:**
- `content`: `String!` - The content of the annotation. Annotations can sometimes be different from the actual text content.
E.g., Mastodon mentions have 'text: @buffer', but includes the server name in the content, 'content: @buffer@threads.net'
- `indices`: `[Int!]!` - The indices of the annotation in the text
- `text`: `String!` - The text representation of the annotation, eg '@buffer'
- `type`: `AnnotationType!` - The type of the annotation
- `url`: `String!` - The URL the annotation points to

#### Author

Represent the author of a post or note.

**Fields:**
- `id`: `AccountId!` - The unique identifier of the author.
- `avatar`: `String!` - The avatar URL of the author.
- `email`: `String!` - The email address of the author.
- `isDeleted`: `Boolean!` - Indicates whether the author is a deleted.
- `name`: `String` - The name of the author. Null if the user has not yet set a name.
- `urn`: `String` - The Buffer account URN for this author, in the form
`urn:buffer:account:<account-id>`. Null when the author is deleted or the
account ID is missing or invalid. A URN identifies an account. It does not
prove that the account exists, that the caller has access, or that the
account can be mentioned.

#### BlueskyMetadata

Bluesky metadata

**Fields:**
- `serverUrl`: `String!` - The instance of bluesky of the channel

#### BlueskyPostMetadata

Bluesky post metadata

**Implements:** CommonPostMetadata, ThreadedPostMetadata

**Fields:**
- `annotations`: `[Annotation!]!` - Annotations representing entities in the text
- `linkAttachment`: `LinkAttachment` - Link attachment
- `thread`: `[ThreadedPost!]!` - The list of threaded posts (not paginated)
- `threadCount`: `Int!` - The number of threaded posts
- `type`: `PostType!` - The channel-specific type of the post, eg, post, story, reel for Instagram

#### Channel

Channel entity

**Fields:**
- `id`: `ChannelId!` - The ID of the channel
- `allowedActions`: `[ChannelAction!]!` - The allowed actions for the current user
- `avatar`: `String!` - The avatar URL of the channel
- `descriptor`: `String!` - Formatted name of the channel service and type: e.g. 'Twitter Profile' or 'Facebook Page'
- `displayName`: `String` - The display name of the channel - nullable (reason?)
- `externalLink`: `String` - The channel's URL on the social network (e.g. instagram.com/username or facebook.com/page)
Returns null if the channel is not supported
- `hasActiveMemberDevice`: `Boolean!` - Whether at least one member of the orginization who have access to this channel
also has a user device registered for push notifications
- `isDisconnected`: `Boolean!` - Indicates if the channel is properly connected to Buffer
- `isLocked`: `Boolean!` - Indicates if the channel is locked - Locked channels can't be used for posting.
A channel can be locked when the organization downgrades and reduces the channel quantity of their plan.
- `isNew`: `Boolean!` - Indicates if the channel was recently created (in less than 10 seconds). This is used to determine the redirect modal after channel authorization
- `isQueuePaused`: `Boolean!` - Indicates is the queue is paused for the channel. A paused queue means schedules posts won't be published.
- `linkShortening`: `ChannelLinkShortening!` - Link Shortening settings for the channel
- `metadata`: `ChannelMetadata` - Metadata or settings depending on the service type - such as the server URL for Mastodon or Location data for Facebook/GPB
- `name`: `String!` - The name of the channel - the handle name, username, etc.
- `organizationId`: `OrganizationId!` - The organization ID of the channel
- `postingGoal`: `PostingGoal` - The posting goal for the channel
- `postingSchedule`: `[ScheduleV2!]!` - Provides the posting slots for each day of the week
- `products`: `[Product!]` - Products that support a given channel
- `scopes`: `[String]!` - Scopes requested for a given channel - empty array if we don't have them tracked
- `service`: `Service!` - Represents the social network
- `serviceId`: `String!` - Represents the external ID of the channel on social network API
- `showTrendingTopicSuggestions`: `Boolean!` - Indicates if trending topic suggestions should be shown in the composer.
When false, users can still access trends via the trending icon button.
Defaults to true for backward compatibility.
- `timezone`: `String!` - The timezone of the channel - Default if not set is Europe/London
- `type`: `ChannelType!` - The type of the channel - Page, Profile, Business, Group, Account, etc.
- `weeklyPostingLimit`: `WeeklyPostingLimit` - Weekly posting limit for the channel *(Deprecated: This field is not used anymore)*
- `createdAt`: `DateTime!` - The creation date of the channel
- `updatedAt`: `DateTime!` - The last time the channel was updated

#### ChannelConfiguration

Everything for one connected channel: its engagement capabilities, its full
`content` config, and per-feature authorization. Each channel carries
its own complete config — there is no service-level default to merge against.

**Status:** ⚠️ Experimental

**Fields:**
- `authorizationStatus`: `[FeatureAuthorizationStatus!]!` - Authorization status per feature for this channel. A feature is a capability
a channel can expose — e.g. posting, commenting, mentions, insights (see the
`Feature` enum).
- `channelId`: `ChannelId!` - The connected channel this config describes.
- `channelType`: `ChannelType!` - The channel's type within the service (e.g. profile, page, business).
- `content`: `[ContentConfiguration!]!` - Content config — one entry per content type, or a single entry
grouping several types that share identical rules (post / story / reel /
comment reply).
- `engagement`: `[EngagementTypeConfiguration!]!` - Engagement capabilities — one entry per engagement type. Empty when
engagement isn't supported on the channel.
- `service`: `Service!` - The channel's social service (e.g. twitter, instagram).

#### ChannelLinkShortening

Settings for link shortening

**Fields:**
- `config`: `LinkShorteningConfig` - Configuration of link shortening integration. Null if disabled.
- `isEnabled`: `Boolean!` - If link shortening is enabled for the channel

#### ChannelRefreshRequired

Error returned when the channel needs a refresh

**Status:** ⚠️ Experimental

**Implements:** MutationError

**Fields:**
- `channelIds`: `[ChannelId!]!` - ChannelIds that need refreshing
- `message`: `String!` - Error message

#### Configuration

Organization configuration. `channels` carries the per-connected-channel config
the actor can view (including per-`Feature` `authorizationStatus`); `services`
carries the service-level capability catalog — the engagement and content config
for every supported `service` + `channelType`, independent of which channels are
connected (e.g. for composing before a channel is connected);
`collaborationRoleAbilities` carries the Roles ability catalog.

`@public` is set per field rather than on the type, so a field is external only
when tagged. A new field is internal until it carries its own `@public`.

**Status:** ⚠️ Experimental

**Fields:**
- `channels`: `[ChannelConfiguration!]!` - Per-connected-channel config for every channel the actor can view.
- `services`: `[ServiceConfiguration!]!` - Service-level capability catalog for every supported service + channel type.

#### ConnectedApp

Connected App

**Fields:**
- `category`: `ConnectedAppCategory` - The category of the connected app, when known.
- `clientId`: `ID!` - The id of the connectedApp.
- `description`: `String!` - A brief description of the connected app.
- `name`: `String!` - The name of the connected app.
- `scopes`: `[String!]!` - The access scopes granted to this connection for Buffer's public API
resources. Empty when the connection holds none.
- `userId`: `ID!` - The id of the user that has granted access to the app.
- `website`: `String!` - The website URL of the connected app.
- `createdAt`: `DateTime!` - The date and time when the connected app was created.

#### ContentConfiguration

Config for one or more content types that share the same properties
and rules. Grouping several `configurationContentTypes` in one entry avoids
duplicating an identical config (e.g. story + reel).

**Status:** ⚠️ Experimental

**Fields:**
- `configurationContentTypes`: `[ConfigurationContentType!]!` - The content type(s) this config applies to (grouped when rules are identical).
- `rules`: `[ValidationRule!]!` - Validation rules that decide whether a draft is valid.
- `supportedProperties`: `[ContentProperty!]!` - The properties these content types support; absence means unsupported.

#### ContentItem

A piece of content in Buffer. It starts as a channel-less draft and can later
become a set of channel-specific posts, or it can be created with its posts
directly.

This API is an early preview and can change without a deprecation period.

**Status:** ⚠️ Experimental

**Fields:**
- `id`: `ContentItemId!` - Unique identifier for this content item.
- `accountId`: `AccountId!` - Account that owns this content item.
- `allowedActions`: `[ContentItemAction!]!` - Actions the calling actor can take on this content item. A client reads this
set instead of deriving the authorization rules itself.
- `author`: `Author` - The person who created this content item. Null when that person's account
no longer exists.
- `body`: `ContentItemBody!` - The current content of this item: either a channel-less draft or the
channel-specific posts created from it.
- `organizationId`: `OrganizationId!` - Organization that owns this content item.
- `tags`: `[Tag!]!` - Tags applied to this content item, in the order they were set. A tag
applies to the item as a whole, so it survives the move from a
channel-less draft to channel-specific posts.
- `targetDate`: `DateTime` - Optional date indicating when this piece of content should go out.
This is a planning aid only and does not schedule any posts.
- `title`: `String` - Optional title describing what this piece of content is about.
- `createdAt`: `DateTime!` - When this content item was created.

#### ContentItemEdge

An edge in a content item connection.

**Status:** ⚠️ Experimental

**Fields:**
- `cursor`: `String!` - A cursor for pagination.
- `node`: `ContentItem!` - The content item node at the end of the edge.

#### ContentItemsConnection

A paginated connection of content items.

**Status:** ⚠️ Experimental

**Fields:**
- `edges`: `[ContentItemEdge!]!` - The list of content item edges.
- `pageInfo`: `PaginationPageInfo!` - Pagination information for the connection.
- `totalCount`: `Int!` - The total number of content items matching the request.

#### ContentItemStateError

updateContentItemDraft and promoteContentItemDraftToPosts need a
channel-less draft. They report this error when the item already holds
channel-specific posts. Another request can put the item in that state while
this one runs.

**Status:** ⚠️ Experimental

**Implements:** MutationError

**Fields:**
- `message`: `String!` - Error message.

#### CountRule

Bounds how many of a property are allowed. `min` null/absent = no lower bound
(optional); `min: 1` = required. `max` null = unlimited. At least one of `min`
or `max` is always present — a rule that bounds neither is never emitted.

**Status:** ⚠️ Experimental

**Implements:** ValidationRule

**Fields:**
- `max`: `Int` - Maximum allowed count. Null = unlimited.
- `min`: `Int` - Minimum allowed count. Null = no lower bound (optional).
- `property`: `ContentProperty!` - The content property this rule constrains.

#### CreateContentItemDraftFailure

createContentItemDraft failure. When any part of the input is invalid,
nothing is created.

**Status:** ⚠️ Experimental

**Implements:** MutationError

**Fields:**
- `errors`: `[InvalidInputError!]!` - The recoverable errors behind this failure.
- `message`: `String!` - Summary error message.

#### CreateContentItemDraftSuccess

Successful createContentItemDraft response.

**Status:** ⚠️ Experimental

**Fields:**
- `contentItem`: `ContentItem!` - The content item first created for this request, including its current state.

#### CreateContentItemFailure

createContentItem failure. Every recoverable error is reported together so the
caller can surface them all at once. When the input fails validation, no
content item and no variants are created. When one or more variants fail while
being processed after creation, the content item and all of its variants
already exist; the per-channel errors identify the variants that need
attention.

**Status:** ⚠️ Experimental

**Implements:** MutationError

**Fields:**
- `errors`: `[CreateContentItemError!]!` - The recoverable errors behind this failure.
- `message`: `String!` - Summary error message.

#### CreateContentItemSuccess

Successful createContentItem response.

**Status:** ⚠️ Experimental

**Fields:**
- `content`: `ContentItem!` - The content item created by this mutation.

#### CreateContentItemVariantInvalidInputError

Invalid input for a single post variant in the createContentItem input list.

**Status:** ⚠️ Experimental

**Implements:** MutationError

**Fields:**
- `channelId`: `ChannelId!` - Channel targeted by the failing variant.
- `message`: `String!` - Error message.

#### CreateContentItemVariantLimitReachedError

Limit reached for a single post variant in the createContentItem input list.

**Status:** ⚠️ Experimental

**Implements:** MutationError

**Fields:**
- `channelId`: `ChannelId!` - Channel targeted by the failing variant.
- `message`: `String!` - Error message.

#### CreateContentItemVariantNotFoundError

The channel targeted by a single post variant in the createContentItem input
list was not found or is not accessible.

**Status:** ⚠️ Experimental

**Implements:** MutationError

**Fields:**
- `channelId`: `ChannelId!` - Channel targeted by the failing variant.
- `message`: `String!` - Error message.

#### CreatePostTemplateSuccess

Successful result of an end user creating a post template.

**Status:** 🧪 Preview

**Fields:**
- `postTemplate`: `PostTemplate!` - The newly created post template.

#### CreateSnippetSuccess

Success response of the createSnippet mutation.

**Status:** ⚠️ Experimental

**Fields:**
- `snippet`: `Snippet!` - The snippet that was created.

#### DailyPostingLimitStatus

Posting limit status at an intended posting time. For X, counts describe the
busiest rolling 24-hour window affected by adding a post at that time, including
later scheduled posts. Other networks use the channel's local calendar day.
Counts include existing posts only, excluding the proposed post.

**Fields:**
- `channelId`: `ChannelId!` - The channel ID this status refers to.
- `isAtLimit`: `Boolean!` - Whether adding a post at the requested time would exceed the posting limit.
- `limit`: `Int` - The network daily posting limit. Null means unlimited.
- `scheduled`: `Int!` - Number of existing scheduled posts in the evaluated window.
- `sent`: `Int!` - Number of existing sent posts in the evaluated window.

#### DeleteContentItemFailure

deleteContentItem failure. When any post cannot be deleted, nothing is
deleted: the content item and all of its posts remain unchanged. Every
blocked post is reported together so the caller can surface them all at
once.

**Status:** ⚠️ Experimental

**Implements:** MutationError

**Fields:**
- `errors`: `[PostNotDeletableError!]!` - The recoverable errors behind this failure.
- `message`: `String!` - Summary error message.

#### DeletePostSuccess

deletePost success response returns the post id that was deleted.

**Fields:**
- `id`: `PostId!` - Post id that was delete.

#### DeleteSnippetSuccess

Success response of the deleteSnippet mutation.

**Status:** ⚠️ Experimental

**Fields:**
- `id`: `SnippetId!` - The id of the deleted snippet.

#### DeleteTagActionSuccess

Returned when a tag was deleted successfully.

**Status:** ⚠️ Experimental

**Fields:**
- `id`: `TagId!` - The id of the tag that was deleted.

#### DocumentAsset

Document asset

**Implements:** Asset

**Fields:**
- `id`: `ID` - The ID of the asset in the database
- `document`: `DocumentMetadata!` - Document specific metadata
- `mimeType`: `String!` - The MIME type of the asset
- `source`: `String!` - URL to the file source
- `thumbnail`: `String!` - URL to the static thumbnail of the asset
- `type`: `AssetType!` - The type of the asset

#### DocumentMetadata

Document metadata

**Fields:**
- `filesize`: `Int` - Document fileSize in bytes
- `numPages`: `Int!` - Number of pages in the document
- `thumbnails`: `[String!]!` - URLs to the static thumbnails of the document pages
- `title`: `String` - Document title

#### DraftContent

A content draft that is not attached to any channel yet. Because no channel
is selected, no network-specific rules apply, including media type
restrictions.

**Status:** ⚠️ Experimental

**Fields:**
- `id`: `DraftContentId!` - Unique identifier for this draft.
- `aiAssisted`: `Boolean!` - True when the draft content was written with the help of AI.
- `assets`: `[Asset!]!` - Images, videos, or documents attached to the draft, in display order.
- `text`: `String!` - The written content of the draft. Empty when the draft holds only assets.

#### DuplicateError

Error returned when a unique constraint is violated

**Implements:** MutationError

**Fields:**
- `message`: `String!` - Error message

#### DurationRule

Caps the duration of a time-based media property.

**Status:** ⚠️ Experimental

**Implements:** ValidationRule

**Fields:**
- `maxDurationSeconds`: `Int!` - Maximum allowed duration in seconds.
- `property`: `ContentProperty!` - The content property this rule constrains.

#### EmptySuccess

Empty mutation success response used when client doesn't need any data back
or simply needs to respond to a success or error.

**Implements:** MutationSuccess

**Fields:**
- `_empty`: `String!` - The value is always an empty string ''
Note: GraphQL doesn't allow types with no fields, so we have to add this field

#### EngagementSupportedReaction

A supported reaction. `reactionType` is the opaque identity echoed back on the
react mutation; `visual` carries everything needed to render it.

**Status:** ⚠️ Experimental

**Fields:**
- `reactionType`: `ReactionType!` - The kind of reaction a user can apply (e.g. like, love, celebrate). This is
the identifier the client sends back to the react mutation when the user picks
this reaction; treat it as an opaque value rather than parsing it.
- `visual`: `ReactionVisual!` - How to render this reaction (built-in icon or network image).

#### EngagementTypeConfiguration

Per-engagement-type configuration. One entry per kind; `engagementType`
discriminates. Adding a kind is additive — a new `EngagementType` value, not a
new type.

**Status:** ⚠️ Experimental

**Fields:**
- `engagementType`: `EngagementType!` - The kind of engagement this entry configures (comment / mention).
- `media`: `MediaConfiguration!` - Media configuration. Always present; `supportsMedia: false` = the platform
doesn't deliver attached media to Buffer, so none can be shown.
- `metadata`: `EngagementMetadata` - Optional network-specific engagement metadata (e.g. Google Business).
null when none applies.
- `reactions`: `ReactionsConfiguration!` - Reactions. Always present; empty `supportedReactions` = reacting via Buffer
isn't supported.
- `replying`: `ReplyingConfiguration!` - Reply configuration. Always present; `supportsReplying: false` = replying via
Buffer not supported.
- `supportedAiFeatures`: `[AiFeature!]!` - AI features supported for this engagement type. Empty when none.
- `syncData`: `SyncDataConfiguration!` - Sync configuration — realTime/polling mechanism plus optional forced-sync detail.

#### ExclusiveRule

`property` cannot be combined with any of `conflictsWith`.

**Status:** ⚠️ Experimental

**Implements:** ValidationRule

**Fields:**
- `conflictsWith`: `[ContentProperty!]!` - Properties that `property` cannot be combined with.
- `property`: `ContentProperty!` - The content property this rule constrains.

#### FacebookMetadata

Facebook metadata

**Fields:**
- `locationData`: `LocationData` - Metadata about the location of the business associated with the channel. Only available for Facebook and GPB

#### FacebookPostMetadata

Facebook post metadata

**Implements:** CommonPostMetadata

**Fields:**
- `annotations`: `[Annotation!]!` - Annotations representing entities in the text
- `firstComment`: `String` - Facebook post's first comment
- `linkAttachment`: `LinkAttachment` - Link attachment
- `title`: `String` - Title of Facebook reel
- `type`: `PostType!` - The channel-specific type of the post, eg, post, story, reel for Instagram

#### FeatureAuthorizationStatus

Pairs a feature with the channel's authorization status for it (token/scope
level). One entry per authorization-gated feature the channel exposes.

**Status:** ⚠️ Experimental

**Fields:**
- `feature`: `Feature!` - The feature this status describes — a capability a channel can expose, e.g.
posting, commenting, mentions, insights, reacting to engagements (see the
`Feature` enum).
- `reason`: `String` - Why the feature is in its current `status`, when a specific cause is known
(e.g. the connected platform user lacks rights on the account that owns
webhook subscriptions). Informative text for display/support — not a stable
machine key, so clients must not parse or switch on it. Null when the
status needs no explanation (`ok`) or no specific cause was identified.
- `status`: `AuthorizationStatus!` - Whether the channel is currently authorized to use `feature`: `ok` (usable),
`needsRefresh` (token refresh required), `notEnoughData` (missing scopes /
webhook metadata), `needsUpgrade` (client below the minimum version —
applies only to the mobile apps), or `notEnoughRights` (the connected
platform user's role is insufficient — reconnecting cannot fix it). See the
`AuthorizationStatus` enum.

#### FileSizeRule

Caps the byte size of a media property.

**Status:** ⚠️ Experimental

**Implements:** ValidationRule

**Fields:**
- `maxMegabytes`: `Int!` - Maximum allowed size in megabytes (MB).
- `property`: `ContentProperty!` - The content property this rule constrains.

#### ForcedSyncConfiguration

Forced-sync detail. Present only when the kind's sync mechanism supports a
forced (manual) sync.

**Status:** ⚠️ Experimental

**Fields:**
- `forcedSyncRateLimit`: `ForcedSyncRateLimit` - Rate limit for forced syncs. `null` when forced sync is unthrottled. Reuses
the `ForcedSyncRateLimit` type defined by the comment schema.
- `pollInterval`: `Int!` - How often, in seconds, the channel is automatically polled for new items.

#### ForcedSyncRateLimit

Rate limit configuration for forced sync operations.

**Status:** ⚠️ Experimental

**Fields:**
- `allowedAttempts`: `Int!` - Number of allowed forced backfill attempts within the period.
- `period`: `Int!` - Rate limit period in seconds for forced backfill operations.

#### FormatRule

Restricts a media property to specific formats (allow-list).

**Status:** ⚠️ Experimental

**Implements:** ValidationRule

**Fields:**
- `allowedFormats`: `[MediaFormat!]!` - The formats `property` is allowed to use.
- `property`: `ContentProperty!` - The content property this rule constrains.

#### GoogleBusinessEngagementMetadata

Google Business-specific engagement metadata. Distinct from the channel-level
`GoogleBusinessMetadata` (which carries location data) — this is the engagement
surface's rating/note metadata.

**Status:** ⚠️ Experimental

**Fields:**
- `hasUserRating`: `Boolean!` - Whether engagements on this channel carry a user star rating.
- `permanentNote`: `String!` - A permanent note surfaced to the user about this channel's engagements.
Empty when there is nothing to tell the user.

#### GoogleBusinessEventMetaData

Metadata for a GBP post that is an event

**Fields:**
- `button`: `GoogleBusinessPostActionType!` - Action button
- `endDate`: `DateTime!` - End date of the event
- `endTime`: `String` - End time of the event *(Deprecated: get time from the endDate)*
- `isFullDayEvent`: `Boolean!` - Indicate whether the event has a start or end time.
- `link`: `String` - Link to the action
- `startDate`: `DateTime!` - Start date of the event
- `startTime`: `String` - Start time of the event *(Deprecated: get time from the startDate)*
- `title`: `String!` - Title of the event

#### GoogleBusinessMetadata

Google Business metadata

**Fields:**
- `locationData`: `LocationData` - Metadata about the location of the business associated with the channel. Only available for Facebook and GPB

#### GoogleBusinessOfferMetaData

Metadata for a GBP post that is an offer

**Fields:**
- `code`: `String` - Coupon code for the offer
- `endDate`: `DateTime!` - End date of the offer
- `link`: `String` - Link to the offer
- `startDate`: `DateTime!` - Start date of the offer
- `terms`: `String` - Terms and Conditions
- `title`: `String!` - Title of the offer

#### GoogleBusinessPostMetadata

Google Business Profile post metadata
@deprecated: pending proposal for specific GBP post types: update, offer and event metadata types

**Implements:** CommonPostMetadata

**Fields:**
- `annotations`: `[Annotation!]!` - Annotations representing entities in the text
- `details`: `GoogleBusinessPostDetails` - Details of the metadata
- `title`: `String` - Title if available in the given GBP post type: event and offer
- `type`: `PostType!` - The channel-specific type of the post, eg, post, story, reel for Instagram

#### GoogleBusinessWhatsNewMetaData

Metadata for a GBP post of type Whats new

**Fields:**
- `button`: `GoogleBusinessPostActionType!` - Action button
- `link`: `String` - Link to the action

#### IconVisual

Render from the built-in client icon set.

**Status:** ⚠️ Experimental

**Fields:**
- `icon`: `ReactionIcon!` - The built-in icon to render.

#### Idea

Ideas are the main entity in the create space

**Fields:**
- `id`: `ID!` - Unique identifier for the idea
- `content`: `IdeaContent!` - The actual content and metadata of the idea
- `groupId`: `ID` - ID of the group this idea belongs to (if any)
- `organizationId`: `ID!` - ID of the organization that owns this idea
- `position`: `Float` - Numerical position for ordering within a group
- `createdAt`: `Int!` - Unix timestamp of when the idea was created
- `updatedAt`: `Int!` - Unix timestamp of when the idea was last modified

#### IdeaContent

Content of an idea

**Fields:**
- `aiAssisted`: `Boolean!` - Indicates whether AI tools were used in creating this idea
- `date`: `DateTime` - DateTime set by user associated with the idea - this often reflects a target publish date.
- `media`: `[IdeaMedia!]` - List of media items attached to the idea
- `services`: `[Service!]!` - Services tagged by the user - this is typically used to annotate ideas with their target services
- `tags`: `[PublishingTag!]!` - Tags used to categorize and organize the idea
- `text`: `String` - Main body text or description of the idea
- `title`: `String` - Title or headline of the idea

#### IdeaEdge

Pagination type for Ideas

**Fields:**
- `cursor`: `String!` - Opaque cursor for pagination, used to fetch subsequent pages
- `node`: `Idea!` - The idea object

#### IdeaGroup

Idea groups are used to organize ideas in the board

**Fields:**
- `id`: `ID!` - Unique identifier for the idea group.
- `isLocked`: `Boolean!` - Whether the idea group is locked.
- `name`: `String!` - The name of the idea group.

#### IdeaMedia

Media attached to an idea

**Fields:**
- `id`: `ID!` - Unique identifier for the media in Buffer's upload system
- `alt`: `String` - Alternative text description for accessibility
- `size`: `Int` - File size in bytes
- `source`: `IdeaMediaSource` - Source platform information for the media
- `thumbnailUrl`: `String` - URL to a smaller version of the media for preview purposes
- `type`: `MediaType!` - Type of media (e.g., image, video, gif)
- `url`: `String!` - Direct URL to access the media file

#### IdeaMediaSource

Media source for the idea, e.g. Unsplash, Gifphy, etc.

**Fields:**
- `id`: `String` - Unique identifier from the source platform
- `author`: `String` - Name of the content creator/author
- `authorUrl`: `String` - URL to the author's profile on the source platform
- `name`: `String!` - Name of the media source platform (e.g., 'Unsplash', 'Giphy')

#### IdeaResponse

createIdea response type

**Fields:**
- `idea`: `Idea` - The affected idea
- `refreshIdeas`: `Boolean!` - If true, the client should refresh the ideas list because other ideas might have been moved

#### IdeasConnection

Relay connection for paginated ideas.

**Fields:**
- `edges`: `[IdeaEdge!]!` - List of idea edges containing the ideas and their cursors
- `pageInfo`: `PaginationPageInfo!` - Pagination metadata including hasNextPage and endCursor

#### ImageAsset

Image asset

**Implements:** Asset

**Fields:**
- `id`: `ID` - The ID of the asset in the database
- `image`: `ImageMetadata!` - Image specific metadata
- `mimeType`: `String!` - The MIME type of the asset
- `source`: `String!` - URL to the file source
- `thumbnail`: `String!` - URL to the static thumbnail of the asset
- `type`: `AssetType!` - The type of the asset

#### ImageMetadata

Image metadata

**Fields:**
- `altText`: `String!` - Alternative text for accessibility
- `animatedThumbnail`: `String` - Animated thumbnail URL
- `height`: `Int!` - Image height in pixels
- `isAnimated`: `Boolean!` - Is the image animated?
- `userTags`: `[UserTag!]` - User tags in the image
- `width`: `Int!` - Image width in pixels

#### ImageVisual

Render a network-supplied image (e.g. LinkedIn-branded reactions).

**Status:** ⚠️ Experimental

**Fields:**
- `url`: `String!` - URL of the network-supplied reaction image.

#### InstagramAudio

An Instagram music track or original sound that can be attached to a Reel.

**Status:** ⚠️ Experimental

**Fields:**
- `id`: `String!` - Meta audio asset ID
- `coverArtworkUrl`: `URL` - Temporary artwork URL from Meta. May be null.
- `creatorUsername`: `String` - Creator username for original sounds
- `displayArtist`: `String` - Artist name for licensed music
- `duration`: `Int!` - Duration of the audio in milliseconds
- `previewUrl`: `URL` - Temporary preview URL from Meta. May be null.
- `title`: `String!` - Display title for the audio
- `type`: `InstagramAudioType!` - Whether this asset is licensed music or an original sound

#### InstagramAudioCatalogSuccess

Combined music and original sound results, with duplicate audio IDs removed.

**Status:** ⚠️ Experimental

**Fields:**
- `audio`: `[InstagramAudio!]!` - Available tracks, with duplicate audio IDs removed. Meta's order within each
catalog is preserved.

Browsing returns music first, then original sounds. Search returns original
sounds first, then music, to better reflect the search text: creators write
original sound titles, so they usually contain the words people search for,
while music results often don't match the query.
- `failedAudioTypes`: `[InstagramAudioType!]!` - Catalogs that failed to load. Results from successful catalogs are still returned,
including an empty list if that catalog has no available tracks.
If both catalogs fail, the query returns an error instead.

#### InstagramAudioSuccess

Refreshed metadata for one Instagram audio asset.

**Status:** ⚠️ Experimental

**Fields:**
- `audio`: `InstagramAudio!` - Refreshed audio metadata.

#### InstagramGeolocation

Instagram Geolocation

**Fields:**
- `id`: `String` - The id of this location
- `text`: `String` - The name of this location

#### InstagramMetadata

Instagram metadata

**Fields:**
- `defaultToReminders`: `Boolean!` - Indicates if we should default to reminder for Instagram

#### InstagramPostMetadata

Instagram post metadata

**Implements:** CommonPostMetadata

**Fields:**
- `annotations`: `[Annotation!]!` - Annotations representing entities in the text
- `firstComment`: `String` - Instagram post's first comment
- `geolocation`: `InstagramGeolocation` - Geolocation of the post
- `isAiGenerated`: `Boolean!` - Whether the post discloses AI-generated content
- `link`: `String` - Shop Grid link for the post
- `shouldShareToFeed`: `Boolean!` - Indicates whether post should be shared to feed
- `stickerFields`: `InstagramStickerFields` - Sticker fields for reminder-based publishing
- `type`: `PostType!` - The channel-specific type of the post, eg, post, story, reel for Instagram

#### InstagramStickerFields

Instagram fields for reminder-based publishing. Upon the reminder for publishing, the user
is prompted to copy and paste these fields into the Instagram app to complete the post.

**Fields:**
- `music`: `String` - Placeholder text for the post's music
- `other`: `String` - Additional field for any other post content
- `products`: `String` - Placeholder text for the post's linked products
- `text`: `String` - Text for the Story or Reel
- `topics`: `String` - Placeholder text for the post's topics (Reels only)

#### InvalidInputError

Error returned when the input is invalid

**Implements:** MutationError

**Fields:**
- `message`: `String!` - Error message

#### LengthRule

Caps the character length of a text-like property (e.g. 280 for X post text).

**Status:** ⚠️ Experimental

**Implements:** ValidationRule

**Fields:**
- `maxLength`: `Int!` - Maximum allowed character length.
- `property`: `ContentProperty!` - The content property this rule constrains.

#### LimitReachedError

Error returned when the limit is reached

**Implements:** MutationError

**Fields:**
- `message`: `String!` - Error message

#### LinkAttachment

Link attachment

**Implements:** ScrapedLink

**Fields:**
- `expandedUrl`: `String` - Full URL that the link asset has been built from
- `text`: `String!` - Description for the scraped link
- `thumbnail`: `String` - Selected thumbnail for this link preview
- `thumbnails`: `[String!]!` - Thumbnails of media available in the link
- `title`: `String!` - Title for the link attachment
- `url`: `String!` - URL that the link asset has been built from

#### LinkedInMetadata

LinkedIn metadata

**Fields:**
- `shouldShowLinkedinAnalyticsRefreshBanner`: `Boolean!` - Property parsed from scopes indicating whether the client should show the LinkedIn analytics refresh banner

#### LinkedInPostMetadata

LinkedIn post metadata

**Implements:** CommonPostMetadata

**Fields:**
- `annotations`: `[Annotation!]!` - Annotations representing entities in the text
- `firstComment`: `String` - LinkedIn post's first comment
- `linkAttachment`: `LinkAttachment` - Link attachment
- `type`: `PostType!` - The channel-specific type of the post, eg, post, story, reel for Instagram

#### LinkShorteningConfig

Link Shortening Configuration

**Fields:**
- `domain`: `String!` - Domain of the link shortener - eg buff.ly, dub.co,
or the user's custom domain.
- `name`: `String!` - Human readable string to describe the link shortening
service.

#### LocationData

Location data about the channel

**Fields:**
- `googleAccountId`: `String` - Google Account Id of the business
- `location`: `String` - Location of the business associated with the channel
- `mapsLink`: `String` - Link to the map

#### MastodonMetadata

Mastodon metadata

**Fields:**
- `maxCharacters`: `Int!` - Maximum character limit allowed for this channel's server instance
- `serverUrl`: `String!` - The instance of mastodon of the channel

#### MastodonPostMetadata

Mastodon post metadata

**Implements:** CommonPostMetadata, ThreadedPostMetadata

**Fields:**
- `annotations`: `[Annotation!]!` - Annotations representing entities in the text
- `spoilerText`: `String` - Spoiler text hiding the root text of this post
- `thread`: `[ThreadedPost!]!` - The list of threaded posts (not paginated)
- `threadCount`: `Int!` - The number of threaded posts
- `type`: `PostType!` - The channel-specific type of the post, eg, post, story, reel for Instagram

#### MediaConfiguration

Media configuration for an engagement type — whether media attached to an
engagement reaches Buffer and can therefore be shown to the user.

**Status:** ⚠️ Experimental

**Fields:**
- `additionalInformation`: `String` - User-facing explanation of what the client can do about the missing media,
worded for the platform (e.g. "Instagram doesn't send media with mentions to
Buffer. Open the mention natively to see the full content."). Display text
only — not a stable machine key, so clients must not parse or switch on it.
Null when `supportsMedia` is true.
- `disclaimer`: `String` - User-facing explanation of why media isn't shown. Display text only — not a
stable machine key, so clients must not parse or switch on it. Null when
`supportsMedia` is true.
- `supportsMedia`: `Boolean!` - Whether media attached to this engagement type is delivered by the platform
and can be shown.

#### MemberConnection

Represents the members connection edge. Later, we can add the list of members with the page info to follow our connection edge pattern.

**Fields:**
- `totalCount`: `Int!` - The total count of team members counting the org owner and team members from the Publish DB.

#### Note

Note entity

**Fields:**
- `id`: `NoteId!` - The unique identifier of the note.
- `allowedActions`: `[NoteAction!]!` - The allowed actions a user can perform on the note.
- `author`: `Author!` - The author of the note - null if the user is deleted or left the organization.
- `text`: `String!` - The content of the note.
- `type`: `NoteType!` - The type of the note.
- `createdAt`: `DateTime!` - The date and time when the note was created.
- `updatedAt`: `DateTime` - The date and time when the note was last edited.

#### NotFoundError

Error returned when the resource is not found

**Implements:** MutationError

**Fields:**
- `message`: `String!` - Error message

#### Organization

Organization is a representation of a Buffer Organization.

**Fields:**
- `id`: `OrganizationId!` - The ID of the organization.
- `channelCount`: `Int!` - The total number of channels connected to the organization.
- `limits`: `OrganizationLimits!` - The limits of the organization. Can be used to check if the organization has reached the limit of channels, members, etc.
- `members`: `MemberConnection!` - The members of the organization. Can be used to check the total number of members in the organization. In the future, it might contain more information about the members.
- `name`: `String!` - The name of the organization.
- `ownerEmail`: `String!` - The owner email of the organization.
- `shouldEnforce2FASetup`: `Boolean!` - Whether the requesting actor should be sent through 2FA setup before they
can use this organization. Derived: true only when the org has
`settings.enforce2FA` ON and the actor has no 2FA configured on their own
account.

This is the single source of truth for the forced-2FA gate; app-shell and
publish-frontend redirect to the setup flow when it's true. Exposed to the
API gateway so any stitched consumer reads the same value.

#### OrganizationLimits

Resource limits for an organization including channels, members, and content limits

**Fields:**
- `channels`: `Int!` - The maximum number of channels allowed for the organization.
- `generateContent`: `Int!` - The maximum number of content generations allowed for the organization.
- `ideaGroups`: `Int!` - The maximum number of idea groups allowed for the organization.
- `ideas`: `Int!` - The maximum number of ideas allowed for the organization.
- `members`: `Int!` - The maximum number of members allowed for the organization.
- `postTemplates`: `Int!` - The maximum number of post templates allowed for the organization.
- `savedReplies`: `Int!` - The maximum number of saved replies allowed for the organization.
- `scheduledPosts`: `Int!` - The maximum number of scheduled posts allowed for the organization.
- `scheduledStoriesPerChannel`: `Int!` - The maximum number of scheduled stories allowed per channel.
- `scheduledThreadsPerChannel`: `Int!` - The maximum number of scheduled threads allowed per channel.
- `tags`: `Int!` - The maximum number of tags allowed for the organization.

#### PaginationPageInfo

Information to aid in pagination.

**Fields:**
- `endCursor`: `String` - The last cursor in the list. It can be used to fetch the next page.
- `hasNextPage`: `Boolean!` - When set to true, it means there is a next page available.
- `hasPreviousPage`: `Boolean!` - When set to true, it means there is a previous page available. Will always return false for now as we only support forward pagination.
- `startCursor`: `String` - The first cursor in the list. It can be used to fetch the previous page.

#### PinterestBoard

A Pinterest board

**Fields:**
- `id`: `String!` - The ID of the board
- `avatar`: `String` - The board avatar
- `description`: `String` - The board description
- `name`: `String!` - The board name
- `serviceId`: `String!` - The ID of the service
- `url`: `String!` - The board URL

#### PinterestMetadata

Pinterest metadata

**Fields:**
- `boards`: `[PinterestBoard!]!` - The list of boards the user has on Pinterest

#### PinterestPostMetadata

Pinterest post metadata

**Implements:** CommonPostMetadata

**Fields:**
- `annotations`: `[Annotation!]!` - Annotations representing entities in the text
- `board`: `PinterestBoard` - The board the Pin is saved to
- `title`: `String` - The title of the Pin
- `type`: `PostType!` - The channel-specific type of the post, eg, post, story, reel for Instagram
- `url`: `String` - The Pin destination link

#### Post

Post entity

**Fields:**
- `id`: `PostId!` - The ID of the post
- `allowedActions`: `[PostAction!]!` - Indicates what actions the current account can perform on the post
- `assets`: `[Asset!]!` - assets
- `author`: `Author` - Represents the user who created the post
- `channel`: `Channel!` - channel
- `channelId`: `ChannelId!` - channel ID (faster than resolving the channnel.id)
- `channelService`: `Service!` - channel service (faster than resolving the channnel.service)
- `contentItemId`: `ContentItemId` - The content item this post belongs to. Null when the post belongs to no
content item. *(⚠️ Experimental)*
- `dueAt`: `DateTime` - Date when the post is scheduled to be published
- `error`: `PostPublishingError` - error
- `externalLink`: `String` - The external URL of the post at the destination service
- `ideaId`: `IdeaId` - Is set when the Post is generated from an Idea
- `isCustomScheduled`: `Boolean!` - Indicates whether time to publish was manually selected by the user
- `metadata`: `PostMetadata` - Metadata of the post which differs based on the social network/service
@see post.metadata.graphql
- `metrics`: `[PostMetric!]` - Metrics for the sent post. If post is not yet sent, this field will be null
- `metricsUpdatedAt`: `DateTime` - Timestamp of when `metrics` were last refreshed from the network. Null
until the daily ingestion job has processed the post. Buffer pulls
fresh metrics once per day, so this can lag the network value by ~24h.
- `notes`: `[Note!]!` - notes
- `notificationStatus`: `NotificationStatus` - notificationStatus: notified or markedAsPublished
- `schedulingType`: `SchedulingType` - How the post publishes: `notification` for a reminder that asks someone to
publish it by hand, `automatic` for one the publishing workers send.
- `sentAt`: `DateTime` - Date when the post is published
- `sharedNow`: `Boolean!` - Indicates whether the post was shared via publish now action
- `shareMode`: `ShareMode!` - Indicates the share mode of the post (e.g., addToQueue, shareNext, shareNow, customScheduled)
- `status`: `PostStatus!` - status
- `tags`: `[Tag!]!` - tags - sorted by name in ascending order
- `text`: `String!` - Text content of the Post
- `via`: `PostVia!` - Indicates if the post is created from Buffer or the API
- `createdAt`: `DateTime!` - Date when the post was created
- `updatedAt`: `DateTime!` - Date when the post was updated

#### PostActionSuccess

Success response returns the full up-to-date post from after the action was performed.

**Fields:**
- `post`: `Post!` - Post on which the action was successfully performed.

#### PostChannelNotFoundError

The channel targeted by a single post in the promoteContentItemDraftToPosts
input list was not found or is not accessible.

**Status:** ⚠️ Experimental

**Implements:** MutationError

**Fields:**
- `channelId`: `ChannelId!` - Channel targeted by the failing post.
- `message`: `String!` - Error message.

#### PostContent

The fixed set of channel-specific posts created from a content item. Each
post targets a single channel and follows that channel's network rules.

**Status:** ⚠️ Experimental

**Fields:**
- `posts`: `[Post!]!` - The posts created for this content item, one per channel. Individual posts
are edited through their own mutations.

#### PostingGoal

Represents a posting goal for a channel, including target, progress, and status information.

**Fields:**
- `goal`: `Int!` - The target number of posts for this goal.
- `periodEnd`: `DateTime!` - The end date of the period for this posting goal.
- `periodStart`: `DateTime!` - The start date of the period for this posting goal.
- `scheduledCount`: `Int!` - The number of posts that are scheduled to be sent for this goal.
- `sentCount`: `Int!` - The number of posts that have been sent (published or ingested) for this goal.
- `status`: `PostingGoalStatus!` - The current status of the posting goal.

#### PostInvalidInputError

Invalid input for a single post in the promoteContentItemDraftToPosts input
list.

**Status:** ⚠️ Experimental

**Implements:** MutationError

**Fields:**
- `channelId`: `ChannelId!` - Channel targeted by the failing post.
- `message`: `String!` - Error message.

#### PostLimitReachedError

Limit reached for a single post in the promoteContentItemDraftToPosts input
list.

**Status:** ⚠️ Experimental

**Implements:** MutationError

**Fields:**
- `channelId`: `ChannelId!` - Channel targeted by the failing post.
- `message`: `String!` - Error message.

#### PostMetric

A single metric for a post (or an entry in an aggregated metrics response).

**Fields:**
- `description`: `String!` - A human-readable description of what the metric represents.
- `name`: `String!` - The human-readable name of the metric (e.g. "Reactions", "Eng. Rate").
- `type`: `PostMetricType!` - The type of metric. Cross-network metrics use unified naming (`reactions`,
`comments`, etc.); network-specific metrics retain their network's
vocabulary (`saves`, `quotes`, etc.). See `PostMetricType` for the full
catalog including deprecated values.
- `unit`: `PostMetricUnit!` - The unit (count vs percentage) of `value`.
- `value`: `Float!` - The metric value. Defaults to 0 when the network did not report the metric.

#### PostNotDeletableError

A post in this content item cannot be deleted, so the item cannot be
deleted either. Either the post is publishing or has already published,
and posts in those states can no longer be deleted, or this account is
not allowed to delete posts on that channel.

**Status:** ⚠️ Experimental

**Implements:** MutationError

**Fields:**
- `channelId`: `ChannelId!` - Channel targeted by the post that cannot be deleted.
- `message`: `String!` - Error message.

#### PostPublishingError

Post publishing error

**Fields:**
- `message`: `String!` - Error message to display
- `rawError`: `String` - The original error from the publishing service (internal use only)
- `supportUrl`: `String` - Link to a help center article to help resolve the error

#### PostsEdge

Represent a node in the pagination result using the Connect Relay convention.

**Fields:**
- `cursor`: `String!` - Opaque cursor to be used in pagination to fetch from current node.
- `node`: `Post!` - Represents the current post in the list.

#### PostsResults

Results for the posts query.

**Fields:**
- `edges`: `[PostsEdge!]` - The list of posts that match the query.
- `pageInfo`: `PaginationPageInfo!` - Information to aid in pagination.

#### PostTemplate

A post template used for content inspiration.

**Fields:**
- `id`: `PostTemplateId!` - The unique identifier for the template. *(🧪 Preview)*
- `body`: `String!` - The main content body of the template, may contain {{placeholders}}. *(🧪 Preview)*
- `description`: `String!` - A short user-facing description of the template. *(🧪 Preview)*
- `emoji`: `String!` - The emoji associated with the template. *(🧪 Preview)*
- `organizationId`: `OrganizationId!` - The organization that owns this template. *(🧪 Preview)*
- `title`: `String!` - The title of the template. *(🧪 Preview)*
- `visibility`: `PostTemplateVisibility!` - The visibility level of the template. `public` is returned for
Buffer-managed templates. *(🧪 Preview)*
- `createdAt`: `DateTime!` - The date and time the template was created. *(🧪 Preview)*
- `updatedAt`: `DateTime!` - The date and time the template was last updated. *(🧪 Preview)*

#### PostTemplateEdge

An edge in a post template connection.

**Status:** 🧪 Preview

**Fields:**
- `cursor`: `String!` - A cursor for pagination.
- `node`: `PostTemplate!` - The post template node at the end of the edge.

#### PostTemplatesConnection

A paginated connection of post templates.

**Status:** 🧪 Preview

**Fields:**
- `edges`: `[PostTemplateEdge!]!` - The list of post template edges.
- `pageInfo`: `PaginationPageInfo!` - Pagination information for the connection.
- `totalCount`: `Int!` - The total number of templates matching the filters.

#### Preferences

Account preferences

**Fields:**
- `timeFormat`: `String`
- `startOfWeek`: `String`
- `defaultScheduleOption`: `ScheduleOption!`

#### PromoteContentItemDraftToPostsFailure

promoteContentItemDraftToPosts failure. Every recoverable error is reported
together so the caller can surface them all at once — for example, every
post that failed validation across every targeted channel. A failure does
not always mean nothing changed: post-processing errors are reported after
the promotion has taken effect.

**Status:** ⚠️ Experimental

**Implements:** MutationError

**Fields:**
- `errors`: `[PromoteContentItemDraftToPostsError!]!` - The recoverable errors behind this failure.
- `message`: `String!` - Summary error message.

#### PromoteContentItemDraftToPostsSuccess

Successful promoteContentItemDraftToPosts response.

**Status:** ⚠️ Experimental

**Fields:**
- `contentItem`: `ContentItem!` - The promoted content item.

#### PublishingTag

Tag snapshot associated with content

**Fields:**
- `id`: `ID!`
- `color`: `String!` - Hex color for tag e.g #F523F1
- `colorName`: `TagColorName` - Stable Buffer palette identifier derived from `color`.
Clients should map this value to platform- and theme-specific presentation,
falling back to `color` when this field is null or unsupported.
Returns null for custom or unrecognized colors.
- `name`: `String!`

#### ReactionsConfiguration

Reactions configuration. `restingIcon` is always populated; `supportedReactions`
empty = reacting via Buffer isn't supported, one = single-button liking, multiple
= a reaction set.

**Status:** ⚠️ Experimental

**Fields:**
- `requiresAuthorization`: `Boolean!` - Whether reacting needs an OAuth scope beyond the ones a base connection
grants. When true, check the channel's `engagementReaction` entry in
`authorizationStatus` before offering the reaction — the channel may need a
reconnect to grant it. On the service-level catalog this is channel-agnostic
and may overstate the requirement, since it can vary with a channel's login
flow; the per-channel configuration resolves it exactly.
- `restingIcon`: `ReactionIcon!` - The resting-state icon — the pre-reaction icon.
- `supportedReactions`: `[EngagementSupportedReaction!]!` - The reactions the user can apply. Empty when reacting via Buffer isn't supported.

#### RemovePostFromContentItemSuccess

Successful removePostFromContentItem response.

**Status:** ⚠️ Experimental

**Fields:**
- `contentItem`: `ContentItem!` - The content item after the post left it.
- `post`: `Post!` - The post after the mutation removed it. It belongs to no content item.

#### ReplyingConfiguration

Reply configuration for an engagement type. A rich object (not a bare boolean)
so reply metadata can be added later.

**Status:** ⚠️ Experimental

**Fields:**
- `prefixReplyWithMention`: `Boolean!` - Whether replies should be prefixed with the author's @mention.
- `supportsReplying`: `Boolean!` - Whether replying to this engagement type via Buffer is supported.

#### RequiresRule

`property` requires all of `requires` to also be present.

**Status:** ⚠️ Experimental

**Implements:** ValidationRule

**Fields:**
- `property`: `ContentProperty!` - The content property this rule constrains.
- `requires`: `[ContentProperty!]!` - Properties that must also be present when `property` is used.

#### RestProxyError

An error passed through from Buffer's legacy REST API.

**On the way out.** This type exists only because some mutations still forward
to that API. It is never returned by the tag mutations, and will be removed from
their payloads. The post mutations can still return it, so keep handling it
there for now.

Do not select it in new operations. Select `... on MutationError { message }`
instead, which every error type implements and which keeps working when this one
goes away.

**Implements:** MutationError

**Fields:**
- `code`: `Int` - Error code from the REST API response - https://buffer.com/developers/api/errors *(Deprecated: Being retired along with Buffer's legacy REST API. Select `... on MutationError { message }` to handle errors generically, or the specific recoverable error members of the payload.)*
- `link`: `String` - Link to our Help center from the REST API response *(Deprecated: Being retired along with Buffer's legacy REST API. Select `... on MutationError { message }` to handle errors generically, or the specific recoverable error members of the payload.)*
- `message`: `String!` - An error message from the REST API response that we proxied here

#### RetweetMetadata

Information about the initial Tweet that was retweeted

**Implements:** ScrapedLink

**Fields:**
- `id`: `String!` - Retweet ID
- `text`: `String!` - Text of the original tweet
- `thumbnails`: `[String!]!` - Thumbnails to media available in the link
- `url`: `String!` - Link to original tweet
- `user`: `RetweetUserMetadata!` - User who created the original tweet
- `createdAt`: `DateTime!` - Date when the original tweet was created

#### RetweetUserMetadata

Information about the initial author of the Tweet that was retweeted

**Fields:**
- `avatar`: `String!` - Avatar of the user who created the original Tweet
- `name`: `String!` - Name of the user who created the original Tweet
- `username`: `String!` - Username of the user who created the original Tweet

#### ScheduleV2

Posting schedule for a specific day of the week

**Fields:**
- `day`: `DayOfWeek!` - The day of the week: mon, tue, wed, thu, fri, sat, sun
- `paused`: `Boolean!` - Indicates if this day is paused in the posting schedule.
- `times`: `[String!]!` - The times the channel is scheduled to post on the day: HH:MM

#### SearchInstagramAudioSuccess

Success response for searching Instagram audio

**Status:** ⚠️ Experimental

**Fields:**
- `audio`: `[InstagramAudio!]!` - Matching or trending audio assets

#### ServiceConfiguration

Service-level configuration for one supported `service` + `channelType`: its
engagement capabilities and `content`. The channel-agnostic baseline — today
the same fields as `ChannelConfiguration` minus `channelId` and the per-channel
`authorizationStatus`. This overlap is incidental, not a contract: it is a
distinct type so the service-level catalog can evolve independently of the
per-channel config (either side may add fields the other doesn't share).

**Status:** ⚠️ Experimental

**Fields:**
- `channelType`: `ChannelType!` - The channel type within the service (e.g. profile, page, business).
- `content`: `[ContentConfiguration!]!` - Content config — one entry per content type, or a single entry
grouping several types that share identical rules. Empty when none is exposed.
- `engagement`: `[EngagementTypeConfiguration!]!` - Engagement capabilities — one entry per engagement type. Empty when
engagement isn't supported for this service + channel type.
- `service`: `Service!` - The social service this config describes (e.g. twitter, instagram).

#### Snippet

A named set of hashtags that a team member saves once and inserts into posts.

**Status:** ⚠️ Experimental

**Fields:**
- `id`: `SnippetId!` - Unique identifier of the snippet.
- `name`: `String!` - Display name of the snippet.
- `text`: `String!` - The hashtags, as the text that is inserted into a post.

#### SnippetEdge

An edge in a snippets connection.

**Status:** ⚠️ Experimental

**Fields:**
- `cursor`: `String!` - A cursor for pagination.
- `node`: `Snippet!` - The snippet at the end of the edge.

#### SnippetsConnection

A paginated connection of snippets, sorted by name.

**Status:** ⚠️ Experimental

**Fields:**
- `edges`: `[SnippetEdge!]!` - The list of snippet edges.
- `pageInfo`: `PaginationPageInfo!` - Pagination information for the connection.

#### SubstackPostMetadata

Substack post metadata

**Implements:** CommonPostMetadata

**Fields:**
- `annotations`: `[Annotation!]!` - Annotations representing entities in the text
- `linkAttachment`: `LinkAttachment` - Link attachment
- `type`: `PostType!` - The channel-specific type of the post, eg, post, story, reel for Instagram

#### SyncDataConfiguration

Sync configuration for an engagement type — the realTime/polling
`syncDataMechanism` plus optional forced-sync detail.

**Status:** ⚠️ Experimental

**Fields:**
- `forcedSyncConfiguration`: `ForcedSyncConfiguration` - Forced-sync detail. A forced sync is a user-triggered (manual) refresh that
fetches new items on demand instead of waiting for the next scheduled poll or
push. `null` when this kind's sync mechanism has no forced-sync support.
- `syncDataMechanism`: `SyncDataMechanism!` - How this engagement type syncs on this channel: `realTime` (push) or
`polling` (pull).

#### Tag

A label an organization applies to posts and ideas so they can be grouped and
filtered together. Tags belong to the organization and are shared by everyone
in it, rather than being per channel or per person.

**Fields:**
- `id`: `TagId!` - The tag's unique identifier.
- `color`: `String!` - The tag's color as a hex triplet, for example `#F523F1`. Use `colorName`
where you need a stable identifier rather than a literal color.
- `colorName`: `TagColorName` - Stable Buffer palette identifier derived from `color`.
Clients should map this value to platform- and theme-specific presentation,
falling back to `color` when this field is null or unsupported.
Returns null for custom or unrecognized colors.
- `isLocked`: `Boolean!` - Whether the tag is locked.

A tag locks when the organization holds more tags than its plan allows,
typically after a downgrade. Buffer locks the excess rather than deleting it,
so nothing is lost if the organization upgrades again.

A locked tag **cannot be edited** — `updateTag` rejects it. It can still be
read, deleted, and applied to posts through the API. Buffer's own apps also
hide locked tags when picking a tag for a post; that is a client convention,
not something the API enforces.

Locking is recalculated when the organization's plan changes, and deleting an
unlocked tag frees a slot for the oldest locked one.
- `name`: `String!` - The tag's display name, for example `Summer sales`.

#### TagActionSuccess

Returned when a tag was created or updated successfully.

**Status:** ⚠️ Experimental

**Fields:**
- `tag`: `Tag!` - The tag as persisted, read back after the write.

#### TagEdge

An edge in a tag connection.

**Status:** ⚠️ Experimental

**Fields:**
- `cursor`: `String!` - A cursor for pagination.
- `node`: `Tag!` - The tag at the end of the edge.

#### TagsConnection

A page of an organization's tags.

**Status:** ⚠️ Experimental

**Fields:**
- `edges`: `[TagEdge!]!` - The list of tag edges.
- `pageInfo`: `PaginationPageInfo!` - Pagination information for the connection.
- `totalCount`: `Int!` - The total number of tags matching the request, across every page.

#### ThreadedPost

A post authored by the user which is posted to a thread.
This is commonly used for long-format twitter and meta threads posts to
allow authored content to span multiple threads.
Threads are represented as a list of replies, each replying to the previous one.

**Fields:**
- `assets`: `[Asset!]!` - Media assets of the threaded post
- `linkAttachment`: `LinkAttachment` - Use metadata.{service}.linkAttachment on the thread item instead. This field will be removed on December 15, 2026. *(Deprecated: Use metadata.{service}.linkAttachment on the thread item instead. This field will be removed on December 15, 2026.)*
- `metadata`: `ThreadItemMetadata` - Service-specific fields for this threaded post
- `text`: `String!` - The text body content of the threaded post

#### ThreadItemBlueskyMetadata

Bluesky fields on a single item of a thread

**Fields:**
- `linkAttachment`: `LinkAttachment` - Link attachment

#### ThreadItemMetadata

Service-specific fields on a single item of a thread. The populated key matches
the post's service.

**Fields:**
- `bluesky`: `ThreadItemBlueskyMetadata` - Bluesky fields for this thread item
- `threads`: `ThreadItemThreadsMetadata` - Threads fields for this thread item

#### ThreadItemThreadsMetadata

Threads fields on a single item of a thread

**Fields:**
- `linkAttachment`: `LinkAttachment` - Link attachment

#### ThreadsPostMetadata

Threads post metadata

**Implements:** CommonPostMetadata, ThreadedPostMetadata

**Fields:**
- `annotations`: `[Annotation!]!` - Annotations representing entities in the text
- `linkAttachment`: `LinkAttachment` - Link attachment
- `locationId`: `String` - LocationId associated with the post
- `locationName`: `String` - Location name associated with the post
- `thread`: `[ThreadedPost!]!` - The list of threaded posts (not paginated)
- `threadCount`: `Int!` - The number of threaded posts
- `topic`: `String` - Topic associated with the post
- `type`: `PostType!` - The channel-specific type of the post, eg, post, story, reel for Instagram

#### TiktokMetadata

Tiktok metadata

**Fields:**
- `defaultToReminders`: `Boolean!` - Indicates if we should default to reminder for Tiktok

#### TiktokPostMetadata

Tiktok post metadata

**Implements:** CommonPostMetadata

**Fields:**
- `annotations`: `[Annotation!]!` - Annotations representing entities in the text
- `isAiGenerated`: `Boolean!` - Whether the post discloses AI-generated content (TikTok video only)
- `title`: `String` - The title of the TikTok post (for photo posts)
- `type`: `PostType!` - The channel-specific type of the post, eg, post, story, reel for Instagram

#### TwitterMetadata

Twitter metadata

**Fields:**
- `subscriptionType`: `String` - Indicates the type of subscription the user has on Twitter

#### TwitterPostMetadata

Twitter post metadata

**Implements:** CommonPostMetadata, ThreadedPostMetadata

**Fields:**
- `annotations`: `[Annotation!]!` - Annotations representing entities in the text
- `isAiGenerated`: `Boolean!` - Whether the post discloses AI-generated content
- `retweet`: `RetweetMetadata` - The details of the tweet being retweeted
- `thread`: `[ThreadedPost!]!` - The list of threaded posts (not paginated)
- `threadCount`: `Int!` - The number of threaded posts
- `type`: `PostType!` - The channel-specific type of the post, eg, post, story, reel for Instagram

#### UnauthorizedError

Error returned when the user is not authorized to perform the action

**Implements:** MutationError

**Fields:**
- `message`: `String!` - Error message

#### UnexpectedError

Error returned when unexpected error occurs

**Implements:** MutationError

**Fields:**
- `message`: `String!` - Error message

#### UpdateContentItemDraftFailure

updateContentItemDraft failure.

**Status:** ⚠️ Experimental

**Implements:** MutationError

**Fields:**
- `errors`: `[UpdateContentItemDraftError!]!` - The recoverable errors behind this failure.
- `message`: `String!` - Summary error message.

#### UpdateContentItemDraftSuccess

Successful updateContentItemDraft response.

**Status:** ⚠️ Experimental

**Fields:**
- `contentItem`: `ContentItem!` - The updated content item.

#### UpdateContentItemFailure

updateContentItem failure. When any part of the input is invalid, nothing is
changed.

**Status:** ⚠️ Experimental

**Implements:** MutationError

**Fields:**
- `errors`: `[InvalidInputError!]!` - The recoverable errors behind this failure.
- `message`: `String!` - Summary error message.

#### UpdateContentItemSuccess

Successful updateContentItem response.

**Status:** ⚠️ Experimental

**Fields:**
- `contentItem`: `ContentItem!` - The content item after the update.

#### UpdatePostTemplateSuccess

Successful result of an end user updating a post template.

**Status:** 🧪 Preview

**Fields:**
- `postTemplate`: `PostTemplate!` - The updated post template.

#### UpdateSnippetSuccess

Success response of the updateSnippet mutation.

**Status:** ⚠️ Experimental

**Fields:**
- `snippet`: `Snippet!` - The snippet after the update.

#### UserTag

User tag in the image

**Fields:**
- `handle`: `String!` - The handle (username) of the tagged account, without the leading @.
- `x`: `Float!` - Horizontal position of the tag as a normalized decimal float between 0.0 and 1.0 - the fraction of the image width from the left edge (0.5 is the horizontal center).
- `y`: `Float!` - Vertical position of the tag as a normalized decimal float between 0.0 and 1.0 - the fraction of the image height from the top edge (0.5 is the vertical center).

#### VideoAsset

Video asset

**Implements:** Asset

**Fields:**
- `id`: `ID` - The ID of the asset in the database
- `mimeType`: `String!` - The MIME type of the asset
- `source`: `String!` - URL to the file source
- `thumbnail`: `String!` - URL to the static thumbnail of the asset
- `type`: `AssetType!` - The type of the asset
- `video`: `VideoMetadata!` - Video specific metadata

#### VideoMetadata

Video metadata

**Fields:**
- `audioCodec`: `String` - Audio codec
- `containerFormat`: `String` - Video container format
- `durationMs`: `Int!` - Video duration in seconds
- `fileSize`: `Int` - Video fileSize in bytes
- `frameRate`: `Int` - Video framerate
- `height`: `Int!` - Video height in pixels
- `isTranscodingRequired`: `Boolean!` - Whether the video needs to be transcoded before it can be broadcasted
- `isVideoProcessing`: `Boolean!` - Whether the video is currently being processed (transcoding in progress)
- `rotationDegree`: `Int` - Rotation degree
- `thumbnailOffset`: `Int` - Offset of the thumbnail chosen for the video, in ms
- `title`: `String` - Video title
- `videoBitRate`: `Int` - Video bitrate in kbps
- `videoCodec`: `String` - Video codec
- `width`: `Int!` - Video width in pixels

#### VoidMutationError

Error implementation that allows clients to resolve the MutationError on mutations that do not currently have typed errors.
This allows clients to automatically handle errors that may be added to a mutation in future.

Do not directly throw this error, use a custom typed error instead

**Implements:** MutationError

**Fields:**
- `message`: `String!` - Error message

#### WeeklyPostingLimit

Weekly posting limit for a channel

**Fields:**
- `limit`: `Int!` - The weekly posting limit for the channel
- `scheduled`: `Int!` - The number of posts the channel has scheduled for this week
- `sent`: `Int!` - The number of posts the channel has sent this week

#### WhatsAppMetadata

The WhatsApp phone's connection details, without credentials or synchronization request IDs.

**Fields:**
- `businessPortfolioId`: `String!` - The Meta business portfolio that owns the WhatsApp Business Account.
- `lastSubscribedAt`: `DateTime` - When Buffer last confirmed the WABA subscription. Null before confirmation.
- `phoneNumberId`: `String!` - Meta's ID for the business phone.
- `wabaId`: `String!` - The WhatsApp Business Account that owns the phone.

#### YoutubeCategory

**Fields:**
- `categoryId`: `String!`
- `title`: `String!`

#### YoutubeMetadata

Youtube metadata

**Fields:**
- `defaultToReminders`: `Boolean!` - Indicates if we should default to reminder for Youtube

#### YoutubePostMetadata

Youtube post metadata

**Implements:** CommonPostMetadata

**Fields:**
- `annotations`: `[Annotation!]!` - Annotations representing entities in the text
- `category`: `YoutubeCategory` - Post category
- `embeddable`: `Boolean!` - Indicates whether the video allows embedding
- `isAiGenerated`: `Boolean!` - Whether the post discloses AI-generated content
- `license`: `YoutubeLicense` - Video license
- `madeForKids`: `Boolean!` - Indicates whether the video is suitable for kids
- `notifySubscribers`: `Boolean!` - Indicates whether to notify subscribers on publish video
- `privacy`: `YoutubePrivacy` - Privacy setting for post
- `title`: `String` - Title of the Youtube post
- `type`: `PostType!` - The channel-specific type of the post, eg, post, story, reel for Youtube

## Input Types

#### AddPostToContentItemInput

Input for addPostToContentItem.

**Fields:**
- `id`: `ContentItemId!` - The content item to add the post to.
- `postId`: `PostId!` - The post to add. The post must already exist. The post and the content item
must belong to the same organization.

#### AggregatedPostMetricsInput

Input for the `aggregatedPostMetrics` query.

**Fields:**
- `channelIds`: `[ChannelId!]` - Optional list of channel IDs to filter by. When omitted (null), the
aggregate spans every channel in the organization the actor has
insights access to. When set to an empty array, no channels match and
the result is empty.
- `endDateTime`: `DateTime!` - End of the aggregation window. Consumers typically pass UTC midnight of
the last calendar day in the window (the backend treats the range as
inclusive of that day), for example `2026-01-31T00:00:00Z`. Date range
is capped to 365 days.
- `organizationId`: `OrganizationId!` - The organization ID
- `startDateTime`: `DateTime!` - Start of the aggregation window. Consumers typically pass UTC midnight
of the first calendar day in the window, for example
`2026-01-01T00:00:00Z`.
- `tags`: `TagComparator` - Filter to posts with specific tags.
When omitted, all posts are included regardless of tags.

#### AnnotationInputFacebook

Annotation representing all the entities in the text

**Fields:**
- `content`: `String!` - The content of the annotation, e.g. '107509875938399'
- `indices`: `[Int!]!` - The indices of the annotation in the text, e.g. [6, 9] (from 6 to 9 characters in the text)
- `text`: `String!` - The text representation of the annotation, eg 'Buffer'
- `url`: `String!` - The URL the annotation points to, e.g. https://www.facebook.com/107509875938399

#### AnnotationInputLinkedIn

Annotation representing all the entities in the text

**Fields:**
- `id`: `String!` - The id of the annotation, e.g. 1521226
- `entity`: `String!` - The entity of the annotation, e.g. urn:li:organization:1521226
- `length`: `Int!` - The length of the annotation, e.g. 6
- `link`: `String!` - The link of the annotation, e.g. https://www.linkedin.com/company/bufferapp
- `localizedName`: `String!` - The localized name of the annotation, e.g. Buffer
- `start`: `Int!` - The start of the annotation, e.g. 5
- `vanityName`: `String!` - The vanity name of the annotation, e.g. bufferapp

#### AssetInput

A single entity's asset. Exactly one variant must be provided.

**Fields:**
- `document`: `DocumentAssetInput` - Document asset
- `image`: `ImageAssetInput` - Image asset
- `link`: `LinkAssetInput` - Use metadata.{service}.linkAttachment instead. This field will be removed on December 15, 2026.
- `video`: `VideoAssetInput` - Video asset

#### BlueskyPostMetadataInput

Bluesky post metadata

**Fields:**
- `linkAttachment`: `LinkAttachmentInput` - Link attachment. Mutually exclusive with a non-empty `assets` array — input providing both is rejected.
- `thread`: `[ThreadedPostInput!]` - The ordered list of posts that make up the thread (not paginated). This
array is the source of truth for what gets published: every post in the
thread, including the root post, must be provided here. Posts are
published in order, each replying to the previous one. The first item is
the root post and should match the top-level `text` on the post input.

#### ChannelInput

Input for the channel query

**Fields:**
- `id`: `ChannelId!` - The ID of the channel to be retrieved

#### ChannelsFiltersInput

Filter to pass when fetching channels.

**Fields:**
- `isLocked`: `Boolean` - If not defined, it returns all channels
Else,
  if true, it only returns locked channels
  if false, it only returns not locked channels
- `product`: `Product` - If not passed, it return all channels
Else, it filters the channels based on what the product supports.

#### ChannelsInput

Input to pass when fetching channels.

**Fields:**
- `filter`: `ChannelsFiltersInput` - A list of option filters - passing null means we don't want to filter
- `organizationId`: `OrganizationId!` - The Organization id to fetch channels for

#### ConfigurationInput

Input for the configuration query.

**Fields:**
- `organizationId`: `OrganizationId!` - The organization to return configuration for.

#### ContentItemInput

Input for fetching a single content item by id.

**Fields:**
- `id`: `ContentItemId!` - The unique identifier of the content item to fetch.

#### ContentItemsFilter

Filters for listing content items. Omitted fields do not filter.

**Fields:**
- `contentStatus`: `ContentItemStatus` - Only return content items with this content status. When omitted, content
items in every status are returned.
- `tags`: `TagComparator` - Only return content items carrying one of these tags, or, with `isEmpty`,
content items with no tags at all. Matches the tags applied to the content
item itself, not tags applied later to an individual post.
- `targetDate`: `ContentItemsTargetDateFilter` - Only return content items matching this target date filter.

#### ContentItemsInput

Input for listing an organization's content items.

**Fields:**
- `filter`: `ContentItemsFilter` - Filters to apply. When omitted, all of the organization's content items
are returned.
- `organizationId`: `OrganizationId!` - Organization to list content items for. The caller must be a member of
this organization.
- `sort`: `[ContentItemsSortInput!]` - Sorting to apply, each entry breaking ties in the one before it. Defaults to
newest first. A pagination cursor is only valid for the sort that produced
it, so reset `after` to null whenever the sort changes.

#### ContentItemsSortInput

One sorting criterion for the content items query. List several to break ties.

**Fields:**
- `direction`: `SortDirection!` - The direction to sort by.
- `field`: `ContentItemSortableKey!` - The field to sort by.

#### ContentItemsTargetDateFilter

Filter for a content item's target date. Provide exactly one field
(enforced by @oneOf).

**Fields:**
- `presence`: `DateTimePresence` - Only return content items by whether a target date is set: `present`
returns only dated items, `absent` only undated ones.
- `range`: `DateTimeComparator` - Only return content items whose target date falls within this range.
A range with no bounds returns every content item that has a target date.

#### CreateContentItemDraftInput

Input for createContentItemDraft.

**Fields:**
- `correlationId`: `Uuid` - Client-generated UUID that makes draft creation idempotent. A retry with the
same UUID in the same organization returns the first content item in its
current state.
- `draft`: `DraftContentInput!` - The channel-less draft content to start with.
- `organizationId`: `OrganizationId!` - Organization that will own the content item.
- `tagIds`: `[TagId!]` - Tags to apply to this content item. Omit to create it with no tags.
- `targetDate`: `DateTime` - Optional date indicating when this piece of content should go out. This is
a planning aid only and does not schedule any posts.
- `title`: `String` - Optional title describing what this piece of content is about.

#### CreateContentItemInput

Input for createContentItem.

**Fields:**
- `organizationId`: `OrganizationId!` - Organization that owns the content item and all variants created in it.
- `posts`: `[CreatePostInput!]!` - The channel-specific post variants to create, one per channel. Provide at
least one variant, and at most one variant per channel.
- `tagIds`: `[TagId!]` - Tags to apply to this content item. Omit to create it with no tags.
- `targetDate`: `DateTime` - Optional date indicating when this piece of content should go out. This is
a planning aid only and does not schedule any posts.
- `title`: `String` - Optional title describing what this piece of content is about.

#### CreateIdeaInput

createIdea input type

**Fields:**
- `content`: `IdeaContentInput!` - Content and metadata for the new idea
- `cta`: `String` - Call-to-action identifier for analytics tracking
- `group`: `IdeaGroupInput` - Group placement (null for unassigned group)
- `organizationId`: `ID!` - Organization ID that will own the idea
- `templateId`: `String` - Template ID used to create the idea

#### CreatePostInput

Create post's request input.

Note: `metadata.{service}.linkAttachment` is mutually exclusive with a non-empty `assets`
array. Input providing both is rejected.

**Fields:**
- `aiAssisted`: `Boolean` - If this post was created with the help of AI
- `assets`: `[AssetInput!]!` (default: []) - Ordered list of assets on this post.
- `channelId`: `ChannelId!` - Channel's Id for which we want to create the post
- `draftId`: `DraftId` - Is set when the Post is generated from a Draft
- `dueAt`: `DateTime` - Date when the post is scheduled to be published
- `ideaId`: `IdeaId` - Is set when the Post is generated from an Idea
- `metadata`: `PostInputMetaData` - Metadata of the post which differs based on the social network/service
- `mode`: `ShareMode!` - How the post is being scheduled.
- `needsApproval`: `Boolean!` (default: false) - Submit the post for approval instead of scheduling it. A post submitted for
approval is always a draft, so this conflicts with turning `saveToDraft` off.

Only valid when your posting policy on the target channel requires approval.
- `saveToDraft`: `Boolean` - If true, saves the post as a draft instead of scheduling it.
When saving as draft:
- Post status will be 'draft' instead of 'buffer'
- Posting limits are not checked
- The post will not be published until explicitly scheduled
- `schedulingType`: `SchedulingType!` - Scheduling type to indicate notification publishing or automatic publishing
- `source`: `String` - source where the composer was initiated from, used for tracking.
- `tagIds`: `[TagId!]` - List of tag IDs
- `text`: `String` - Text content of the Post.

Note: for threaded posts, this needs to match the first item in the `thread` array.

#### CreatePostTemplateInput

Input for an end user creating a post template. Buffer-curated
taxonomy fields are server-defaulted; setting them is only available
to official Buffer clients.

**Fields:**
- `body`: `String!` - The main content body of the template, may contain {{placeholders}}.
- `description`: `String` - A short user-facing description of the template. Nullable for
backwards-compat at the GraphQL boundary — the resolver rejects
null/empty values with a clear input error so the underlying
storage contract (non-empty string) is still honored.
- `emoji`: `String` - The emoji associated with the template.
- `organizationId`: `OrganizationId!` - Organization the template belongs to. The caller must be a member of
this organization. For `internal` visibility this is the team scope;
for `private` it's recorded on the template but does not affect
visibility.
- `title`: `String!` - The title of the template.
- `visibility`: `PostTemplateVisibility` - Defaults to `private` if omitted. `public` is rejected — it is only
available to official Buffer clients.

#### CreateSnippetInput

Input for the createSnippet mutation.

**Fields:**
- `name`: `String!` - Display name of the snippet.
- `organizationId`: `OrganizationId!` - The organization that owns the snippet.
- `text`: `String!` - The hashtags, as the text that is inserted into a post.

#### CreateTagInput

Input for creating a tag.

**Fields:**
- `organizationId`: `OrganizationId!` - Organization to create the tag in. The caller must be an administrator of
this organization.
- `tag`: `TagToCreateInput!` - The name and color to give the new tag.

#### DailyPostingLimitsInput

Input for the dailyPostingLimits query.

**Fields:**
- `channelIds`: `[ChannelId!]!` - List of channel IDs to check limits for. All channels must belong to the same organization.
- `date`: `DateTime` - The intended posting time. Defaults to now if not provided.
For X, the exact time determines the affected rolling 24-hour windows.
For other networks, the date selects the channel's local calendar day.

#### DateTimeComparator

Comparator for filtering by date

**Fields:**
- `end`: `DateTime` - Include results with dates equal to or before
the specified date
- `start`: `DateTime` - Include results with dates equal to or after
the specified date

#### DeleteContentItemInput

Input for deleteContentItem.

**Fields:**
- `id`: `ContentItemId!` - The content item to delete.

#### DeletePostInput

deletePost mutation deletes a post by id.

**Fields:**
- `id`: `PostId!` - Post id to delete.

#### DeletePostTemplateInput

Input for an end user deleting a post template.

**Fields:**
- `id`: `PostTemplateId!` - The ID of the template to delete.

#### DeleteSnippetInput

Input for the deleteSnippet mutation.

**Fields:**
- `id`: `SnippetId!` - The snippet to delete.
- `organizationId`: `OrganizationId!` - The organization that owns the snippet.

#### DeleteTagInput

Input for deleting a tag.

**Fields:**
- `id`: `TagId!` - The tag to delete. Its organization is taken from the tag itself, and the
caller must be an administrator of that organization.

#### DocumentAssetInput

Document asset

**Fields:**
- `thumbnailUrl`: `String!` - Document thumbnail URL
- `title`: `String!` - Document title
- `url`: `String!` - Document URL

#### DraftContentInput

A channel-less draft to save on a content item.

**Fields:**
- `aiAssisted`: `Boolean!` (default: false) - Set to true when the draft content was written with the help of AI.
- `assets`: `[AssetInput!]!` (default: []) - Images, videos, or documents to attach to the draft, in display order.
- `text`: `String!` - The written content of the draft. Can be empty when the draft holds at
least one asset.

#### EditPostInput

Edit post's request input.

Note: `metadata.{service}.linkAttachment` is mutually exclusive with a non-empty `assets`
array. Input providing both is rejected.

**Fields:**
- `id`: `PostId!` - ID of the post to edit
- `aiAssisted`: `Boolean` - If this post was edited with the help of AI
- `approvalChange`: `PostApprovalChange` - Change the post's approval state alongside this edit. Leave unset to keep the
post's current approval state.

Only valid when your posting policy on the post's channel requires approval,
and only on your own drafts. Asking for the state the post is already in does
nothing.
- `assets`: `[AssetInput!]` - Ordered list of assets on this post. Omit to preserve the existing list,
pass an empty array to clear it
- `draftId`: `DraftId` - Is set when the Post is generated from a Draft
- `dueAt`: `DateTime` - Date when the post is scheduled to be published
- `ideaId`: `IdeaId` - Is set when the Post is generated from an Idea
- `metadata`: `PostInputMetaData` - Metadata of the post which differs based on the social network/service
- `mode`: `ShareMode` - How the post is being scheduled. Omit the field or pass null to make no
scheduling change — null does not clear or reset the schedule: a scheduled post
keeps its current share mode, queue slot, and any custom time, and the edit
applies only the other provided fields. Pass a non-null ShareMode to apply that
mode.
- `saveToDraft`: `Boolean` - If true, saves the post as a draft instead of keeping it scheduled.
When saving as draft:
- Post status will be 'draft' instead of 'buffer'
- The post will not be published until explicitly scheduled
- `schedulingType`: `SchedulingType` - Scheduling type to indicate notification publishing or automatic publishing.

Omit it, or send null, to leave the post publishing the way it already does.
- `source`: `String` - source where the composer was initiated from, used for tracking.
- `tagIds`: `[TagId!]` - tags
- `text`: `String` - Text content of the Post. Omit the field to keep the current text; pass an
empty string or null to clear it.

Note: for threaded posts, this needs to match the first item in the `thread` array.

#### FacebookPostMetadataInput

Facebook post metadata

**Fields:**
- `annotations`: `[AnnotationInputFacebook!]` - Annotations representing entities in the text
- `firstComment`: `String` - Facebook post's first comment
- `linkAttachment`: `LinkAttachmentInput` - Link attachment. Mutually exclusive with a non-empty `assets` array — input providing both is rejected.
- `type`: `PostTypeFacebook!` - The channel-specific type of the post, eg, post, story, reel for Facebook

#### GoogleBusinessEventMetaDataInput

Metadata for a GBP post that is an event

**Fields:**
- `button`: `GoogleBusinessPostActionType` - Action button. Optional: a post with no button, or `none`, publishes without a call-to-action. On edit, omitting it preserves the existing value.
- `endDate`: `DateTime` - End date of the event. Required on create; optional on edit (omitted preserves existing value).
- `isFullDayEvent`: `Boolean!` - Indicate whether the event has a start or end time.
- `link`: `String` - Link to the action
- `startDate`: `DateTime` - Start date of the event. Required on create; optional on edit (omitted preserves existing value).
- `title`: `String` - Title of the event. Required on create; optional on edit (omitted preserves existing value).

#### GoogleBusinessOfferMetaDataInput

Metadata for a GBP post that is an offer

**Fields:**
- `code`: `String` - Coupon code for the offer
- `endDate`: `DateTime` - End date of the offer. Required on create; optional on edit (omitted preserves existing value).
- `link`: `String` - Link to the offer
- `startDate`: `DateTime` - Start date of the offer. Required on create; optional on edit (omitted preserves existing value).
- `terms`: `String` - Terms and Conditions
- `title`: `String` - Title of the offer. Required on create; optional on edit (omitted preserves existing value).

#### GoogleBusinessPostMetadataInput

Google Business Profile post metadata
@deprecated: pending proposal for specific GBP post types: update, offer and event metadata types

**Fields:**
- `detailsEvent`: `GoogleBusinessEventMetaDataInput` - Details of the Event metadata
- `detailsOffer`: `GoogleBusinessOfferMetaDataInput` - Details of the Offer metadata
- `detailsWhatsNew`: `GoogleBusinessWhatsNewMetaDataInput` - Details of the Whats new metadata
- `title`: `String` - Title if available in the given GBP post type: event and offer
- `type`: `PostTypeGoogleBusiness!` - The channel-specific type of the post, eg, post, offer, event for Google Business Profile

#### GoogleBusinessWhatsNewMetaDataInput

Metadata for a GBP post of type Whats new

**Fields:**
- `button`: `GoogleBusinessPostActionType` - Action button. Optional: a post with no button, or `none`, publishes without a call-to-action. On edit, omitting it preserves the existing value.
- `link`: `String` - Link to the action

#### IdeaContentInput

content input for creating/updating an idea

**Fields:**
- `aiAssisted`: `Boolean` - Whether AI tools were used in creation
- `date`: `DateTime` - Target date for the idea, often used for planning publish schedules
- `media`: `[IdeaMediaInput!]` - List of media items to attach
- `services`: `[Service!]` - Services associated with the idea for targeting specific platforms
- `tags`: `[TagInput!]` - Tags to categorize the idea
- `text`: `String` - Main body text or description
- `title`: `String` - Title or headline of the idea

#### IdeaGroupInput

idea group input for create/update

**Fields:**
- `groupId`: `ID` - Target group ID (null for unassigned group)
- `placeAfterId`: `ID` - ID of idea to place after (null for top position)

#### IdeaGroupsInput

Input type for retrieving idea groups by organization ID.

**Fields:**
- `organizationId`: `ID!` - Unique identifier for the organization.

#### IdeaMediaInput

**Fields:**
- `url`: `String!` - The URL of the media
- `alt`: `String` - Alternative text for the media
- `thumbnailUrl`: `String` - Thumbnail URL for the media
- `type`: `MediaType!` - The type of media (image, gif, video, link, document, unsupported). Note: 'video' is not supported via public API
- `size`: `Int` - The size of the media in bytes
- `source`: `IdeaMediaSourceInput` - Source information for the media

#### IdeaMediaSourceInput

Input type for the source information of media attached to an idea

**Fields:**
- `name`: `String!`
- `id`: `String`
- `trigger`: `String`
- `author`: `String` - for unsplash only
- `authorUrl`: `String`

#### IdeasGroupFilter

Selects which ideas to return by group membership. Exactly one field must be
provided (enforced by @oneOf). To return ideas from all groups, omit
`groupFilter` on IdeasInput rather than setting a field here.

**Fields:**
- `groups`: `[ID!]` - Return only ideas that belong to these specific groups (union/OR).
- `membership`: `IdeaGroupMembership` - Return ideas by a group-membership bucket rather than by specific group IDs.

#### IdeasInput

Filtering criteria for the ideas list.

**Fields:**
- `groupFilter`: `IdeasGroupFilter` - Filter ideas by group membership. Omit this field entirely to return ideas
across all groups.
- `organizationId`: `OrganizationId!` - The organization to fetch ideas from.
- `tagsFilter`: `TagComparator` - Filter ideas by tags using TagComparator.

#### ImageAssetInput

Image asset

**Fields:**
- `metadata`: `ImageMetadataInput` - Image specific metadata
- `thumbnailUrl`: `String` - URL to the static thumbnail of the asset
- `url`: `String!` - URL to the file source

#### ImageDimensionsInput

Image dimensions

**Fields:**
- `height`: `Int!` - Image height in pixels
- `width`: `Int!` - Image width in pixels

#### ImageMetadataInput

Image metadata

**Fields:**
- `altText`: `String!` - Alternative text for accessibility
- `animatedThumbnail`: `String` - Animated thumbnail URL
- `dimensions`: `ImageDimensionsInput` - Ignored — the API resolves image dimensions itself.
- `userTags`: `[UserTagInput!]` - Accounts to tag at specific points on the image. Each tag's x/y position uses normalized 0.0-1.0 coordinates - see UserTagInput.

#### InstagramAudioCatalogInput

Input for browsing trending music and original sounds.

**Fields:**
- `channelId`: `ChannelId!` - Instagram channel used to authorize the catalog request.

#### InstagramAudioInput

Input for refreshing a single Instagram audio asset

**Fields:**
- `audioId`: `String!` - Meta audio asset ID
- `channelId`: `ChannelId!` - Instagram channel used to authorize the refresh

#### InstagramGeolocationInput

Instagram Geolocation

**Fields:**
- `id`: `String` - The id of this location
- `text`: `String` - The name of this location

#### InstagramPostMetadataInput

Instagram post metadata

**Fields:**
- `firstComment`: `String` - Instagram post's first comment
- `geolocation`: `InstagramGeolocationInput` - Geolocation of the post
- `isAiGenerated`: `Boolean` - Whether the post discloses AI-generated content
- `link`: `String` - Shop Grid link for the post
- `shouldShareToFeed`: `Boolean!` - Indicates whether post should be shared to feed
- `stickerFields`: `InstagramStickerFieldsInput` - Sticker fields for reminder-based publishing
- `type`: `PostType!` - The channel-specific type of the post, eg, post, story, reel for Instagram

#### InstagramStickerFieldsInput

Instagram fields for reminder-based publishing. Upon the reminder for publishing, the user
is prompted to copy and paste these fields into the Instagram app to complete the post.

**Fields:**
- `music`: `String` - Placeholder text for the post's music
- `other`: `String` - Additional field for any other post content
- `products`: `String` - Placeholder text for the post's linked products
- `text`: `String` - Text for the Story or Reel
- `topics`: `String` - Placeholder text for the post's topics (Reels only)

#### LinkAssetInput

Link attached to the post

**Fields:**
- `description`: `String` - Description of the link
- `thumbnailUrl`: `String` - Thumbnail URL of the link
- `title`: `String` - Title of the link
- `url`: `String!` - URL to the link

#### LinkAttachmentInput

Link attachment

**Fields:**
- `description`: `String` - Description shown on the link card
- `thumbnail`: `LinkAttachmentThumbnailInput` - Thumbnail shown on the link card
- `title`: `String` - Title shown on the link card
- `url`: `String!` - URL that the link asset has been built from

#### LinkAttachmentThumbnailInput

Thumbnail of a link attachment

**Fields:**
- `url`: `String!` - URL of the thumbnail image

#### LinkedInPostMetadataInput

LinkedIn post metadata

**Fields:**
- `annotations`: `[AnnotationInputLinkedIn!]` - Annotations representing entities in the text
- `firstComment`: `String` - LinkedIn post's first comment
- `linkAttachment`: `LinkAttachmentInput` - Link attachment. Mutually exclusive with a non-empty `assets` array — input providing both is rejected.

#### MastodonPostMetadataInput

Mastodon post metadata

**Fields:**
- `spoilerText`: `String` - Spoiler text hiding the root text of this post
- `thread`: `[ThreadedPostInput!]` - The ordered list of posts that make up the thread (not paginated). This
array is the source of truth for what gets published: every post in the
thread, including the root post, must be provided here. Posts are
published in order, each replying to the previous one. The first item is
the root post and should match the top-level `text` on the post input.

#### MovePostInQueueInput

movePostInQueue mutation moves a queued post to the top or bottom of its channel's queue.

**Fields:**
- `id`: `PostId!` - ID of the post to move.
- `position`: `QueuePosition!` - Target position within the channel's queue.

#### OrganizationFilterInput

Allow retrieving a specific Organization

**Fields:**
- `organizationId`: `String!`

#### PinterestPostMetadataInput

Pinterest post metadata

**Fields:**
- `boardServiceId`: `String` - The board ID of the Pin, can be obtained when fetching the channel details with the following query:
```
query GetChannelWithSubprofiles {
  channel(input: { id: "[CHANNEL_ID_HERE]" }) {
    metadata {
      ... on PinterestMetadata {
        boards {
          serviceId
        }
      }
    }
  }
}
```
Required on create; optional on edit (omitted preserves existing board).
- `title`: `String` - The title of the Pin
- `url`: `String` - The Pin destination link

#### PostInput

Input for the post query

**Fields:**
- `id`: `PostId!` - The ID of the post to be retrieved

#### PostInputMetaData

Metadata of the post which differs based on the social network/service

**Fields:**
- `bluesky`: `BlueskyPostMetadataInput` - Metadata for Bluesky post
- `facebook`: `FacebookPostMetadataInput` - Metadata for Facebook post
- `google`: `GoogleBusinessPostMetadataInput` - Metadata for Google Business Profile post
- `instagram`: `InstagramPostMetadataInput` - Metadata for Instagram post
- `linkedin`: `LinkedInPostMetadataInput` - Metadata for LinkedIn post
- `mastodon`: `MastodonPostMetadataInput` - Metadata for Mastodon post
- `pinterest`: `PinterestPostMetadataInput` - Metadata for Pinterest post
- `substack`: `SubstackPostMetadataInput` - Metadata for Substack post
- `threads`: `ThreadsPostMetadataInput` - Metadata for Threads post
- `tiktok`: `TikTokPostMetadataInput` - Metadata for TikTok post
- `twitter`: `TwitterPostMetadataInput` - Metadata for Twitter post
- `youtube`: `YoutubePostMetadataInput` - Metadata for Youtube post

#### PostsFiltersInput

Filter to apply to the posts query

**Fields:**
- `channelIds`: `[ChannelId!]` - When set, it will filter posts by channel
- `dueAt`: `DateTimeComparator` - When set, it will filter posts by their scheduled posting date
- `dueAtPresence`: `DateTimePresence` - When set, it will filter posts by whether their scheduled posting date exists.
`absent` cannot be combined with `dueAt`, because absent dates cannot also match a date range.
- `endDate`: `DateTime` - When set, it will return posts with createdAt or dueAt date before endDate
- `postTypes`: `[PostType!]` - When set, it will filter posts by format.

`post` is a fallback bucket rather than one stored format: it matches every
post the other formats do not claim, which is what `Post.metadata.type`
reports for the same post. `carousel` and `thread` are rejected, because no
stored value resolves to them.
- `startDate`: `DateTime` - When set, it will return posts with createdAt or dueAt date after startDate
- `status`: `[PostStatus!]` - When set, it will filter posts by status
- `tagIds`: `[TagId!]` - When set, it will filter posts by tag
- `tags`: `TagComparator` - Filter posts by tags. Supports specific tags, untagged posts, or union of both.
- `createdAt`: `DateTimeComparator` - When set, it will filter posts by the date they were created

#### PostsInput

Input for the posts query

**Fields:**
- `filter`: `PostsFiltersInput` - The filters to apply to the posts query
- `organizationId`: `OrganizationId!` - The Organization id to fetch posts for
- `sort`: `[PostSortInput!]` - The sort to apply to the posts results

#### PostSortInput

Sort order of post results. List multiple to create tie-breaking order.

**Fields:**
- `direction`: `SortDirection!` - The direction to sort by.
- `field`: `PostSortableKey!` - The field to sort by.

#### PostTemplateInput

Input for fetching a single post template by ID.

**Fields:**
- `id`: `PostTemplateId!` - The unique identifier of the template to fetch.

#### PostTemplatesFilterInput

Filters for the template library. Visibility narrows the actor-scoped
result set; it can never widen it.

**Fields:**
- `visibility`: `PostTemplateVisibility` - Narrow the result to a single visibility scope. Omit to receive the
union of: public templates, internal templates from the supplied
organization, and private templates from the actor's account.

#### PostTemplatesInput

Input for fetching templates accessible to the current actor for the
template library. A caller can never reach templates outside their own
scope — the server pins `private` to the actor's account and `internal`
to the supplied `organizationId` regardless of input.

**Fields:**
- `filter`: `PostTemplatesFilterInput` - Optional filters to narrow the template list.
- `organizationId`: `OrganizationId!` - Organization to scope `internal`-visibility templates to. The caller
must be a member of this organization.

#### PromoteContentItemDraftToPostsInput

Input for promoteContentItemDraftToPosts.

**Fields:**
- `id`: `ContentItemId!` - The content item to promote.
- `posts`: `[CreatePostInput!]!` - The channel-specific posts to create, one per channel. Provide at least
one post, and at most one post per channel.
- `tagIds`: `[TagId!]` - Tags to apply to this content item. Omit to keep the current tags. An
empty list or null removes them all.

#### RemovePostFromContentItemInput

Input for removePostFromContentItem.

**Fields:**
- `id`: `ContentItemId!` - The content item to remove the post from.
- `postId`: `PostId!` - The post to remove from a content item.

#### RetweetMetadataInput

Information about the initial Tweet that was retweeted

**Fields:**
- `id`: `String!` - Retweet ID
- `comment`: `String` - Optional user comment shown above the embedded retweet

#### SearchInstagramAudioCatalogInput

Input for searching both Instagram audio catalogs.

**Fields:**
- `channelId`: `ChannelId!` - Instagram channel used to authorize the search.
- `query`: `String!` - Search text. Must not be blank.

#### SearchInstagramAudioInput

Input for searching Instagram audio for one channel.

**Fields:**
- `audioType`: `InstagramAudioType!` - Music or original sound catalog
- `channelId`: `ChannelId!` - Instagram channel to search audio for
- `query`: `String!` - Search text. Required. Use trendingInstagramAudio for trending results.

#### SnippetsInput

Input for the snippets query.

**Fields:**
- `organizationId`: `OrganizationId!` - The organization whose snippets to return.

#### SubstackPostMetadataInput

Substack post metadata

**Fields:**
- `linkAttachment`: `LinkAttachmentInput` - Link attachment. Mutually exclusive with a non-empty `assets` array — input providing both is rejected.

#### TagByIdInput

Input for fetching a single tag by id.

**Fields:**
- `id`: `TagId!` - The unique identifier of the tag to fetch.

#### TagComparator

Comparator for filtering by tags

**Fields:**
- `in`: `[TagId!]!` - Include results that have any of the specified tags (union/OR).
- `isEmpty`: `Boolean!` (default: false) - When true, include results that have no tags assigned.
Can be combined with 'in' for union filtering.
Defaults to false if not specified.

#### TagInput

Input type for tag information used in idea creation

**Fields:**
- `id`: `ID!`
- `name`: `String!`
- `color`: `String!`

#### TagsFiltersInput

Filters for listing an organization's tags. Omitted fields do not filter.

**Fields:**
- `isLocked`: `Boolean` - Return only locked tags when true, only unlocked tags when false. Omit to
return both. See `Tag.isLocked` for what locking means.

#### TagsInput

Input for listing an organization's tags.

**Fields:**
- `filter`: `TagsFiltersInput` - Filters to apply. When omitted, all of the organization's tags are returned.
- `organizationId`: `OrganizationId!` - Organization to list tags for. The caller must be a member of this
organization.

#### TagToCreateInput

The name and color to give a new tag.

**Fields:**
- `color`: `String!` - The tag's color as a hex triplet: `#` followed by exactly six hex digits, for
example `#F523F1`. Shorthand such as `#F51` is rejected. Buffer maps
recognized palette colors onto `Tag.colorName`.
- `name`: `String!` - The tag's display name, for example `Summer sales`. Between 1 and 100
characters, and unique within the organization. Names are compared exactly,
so `Summer sales` and `summer sales` can coexist.

#### TagToUpdateInput

The name and color to set on an existing tag. Both are replaced, so send the
current value for the one you are not changing.

**Fields:**
- `color`: `String!` - The tag's color as a hex triplet: `#` followed by exactly six hex digits, for
example `#F523F1`. Shorthand such as `#F51` is rejected. Buffer maps
recognized palette colors onto `Tag.colorName`.
- `name`: `String!` - The tag's display name, for example `Summer sales`. Between 1 and 100
characters, and unique within the organization. Names are compared exactly,
so `Summer sales` and `summer sales` can coexist.

#### ThreadedPostInput

A post authored by the user which is posted to a thread.
This is commonly used for long-format twitter and meta threads posts to
allow authored content to span multiple threads.
Threads are represented as a list of replies, each replying to the previous one.
The first item in the list is the root post of the thread and should match the
top-level `text` on the post input; the remaining items are replies.

**Fields:**
- `assets`: `[AssetInput!]!` (default: []) - Ordered list of assets on this threaded post
- `metadata`: `ThreadItemMetadataInput` - Service-specific fields for this threaded post
- `text`: `String` - The text body content of the threaded post

#### ThreadItemBlueskyMetadataInput

Bluesky fields on a single item of a thread

**Fields:**
- `linkAttachment`: `LinkAttachmentInput` - Link attachment. Mutually exclusive with a non-empty `assets` array — input providing both is rejected.

#### ThreadItemMetadataInput

Service-specific fields on a single item of a thread. The key must match the
channel's service; input under any other key is rejected.

**Fields:**
- `bluesky`: `ThreadItemBlueskyMetadataInput` - Bluesky fields for this thread item
- `threads`: `ThreadItemThreadsMetadataInput` - Threads fields for this thread item

#### ThreadItemThreadsMetadataInput

Threads fields on a single item of a thread

**Fields:**
- `linkAttachment`: `LinkAttachmentInput` - Link attachment. Mutually exclusive with a non-empty `assets` array — input providing both is rejected.

#### ThreadsPostMetadataInput

Threads post metadata

**Fields:**
- `linkAttachment`: `LinkAttachmentInput` - Link attachment. Mutually exclusive with a non-empty `assets` array — input providing both is rejected.
- `locationId`: `String` - LocationId associated with the post
- `locationName`: `String` - Location name associated with the post
- `thread`: `[ThreadedPostInput!]` - The ordered list of posts that make up the thread (not paginated). This
array is the source of truth for what gets published: every post in the
thread, including the root post, must be provided here. Posts are
published in order, each replying to the previous one. The first item is
the root post and should match the top-level `text` on the post input.
- `topic`: `String` - Topic associated with the post
- `type`: `PostType` - The type of the post

#### TikTokPostMetadataInput

TikTok post metadata

**Fields:**
- `isAiGenerated`: `Boolean` - Whether the post discloses AI-generated content (TikTok video only)
- `title`: `String` - The title of the TikTok post (for photo posts)

#### TrendingInstagramAudioInput

Input for trending Instagram audio for one channel.

**Fields:**
- `audioType`: `InstagramAudioType!` - Music or original sound catalog
- `channelId`: `ChannelId!` - Instagram channel to load trending audio for

#### TwitterPostMetadataInput

Twitter post metadata

**Fields:**
- `isAiGenerated`: `Boolean` - Whether the post discloses AI-generated content (original tweets only, never retweets)
- `retweet`: `RetweetMetadataInput` - The details of the tweet being retweeted
- `thread`: `[ThreadedPostInput!]` - The ordered list of posts that make up the thread (not paginated). This
array is the source of truth for what gets published: every post in the
thread, including the root post, must be provided here. Posts are
published in order, each replying to the previous one. The first item is
the root post and should match the top-level `text` on the post input.

#### UpdateContentItemDraftInput

Input for updateContentItemDraft.

**Fields:**
- `id`: `ContentItemId!` - The content item whose channel-less draft is replaced.
- `draft`: `DraftContentInput!` - The new draft content. Replaces the current draft in full.
- `tagIds`: `[TagId!]` - Tags to apply to this content item. Omit to keep the current tags. An
empty list or null removes them all.
- `targetDate`: `DateTime` - Date indicating when this piece of content should go out. This is a
planning aid only and does not schedule any posts. Omit to preserve the
existing target date. Null clears it.

#### UpdateContentItemInput

Input for updateContentItem. Only the fields provided are changed. Omitted
fields keep their current value.

**Fields:**
- `id`: `ContentItemId!` - The content item to update.
- `targetDate`: `DateTime` - Omit to preserve the existing target date. Null clears it.
- `title`: `String` - Omit to preserve the existing title. Null clears it.

#### UpdatePostTemplateInput

Input for an end user updating a post template. Buffer-curated
taxonomy fields are ignored; setting them is only available to
official Buffer clients.

**Fields:**
- `id`: `PostTemplateId!` - The ID of the template to update.
- `body`: `String` - The main content body of the template, may contain {{placeholders}}.
- `description`: `String` - A short user-facing description of the template.
- `emoji`: `String` - The emoji associated with the template.
- `title`: `String` - The title of the template.
- `visibility`: `PostTemplateVisibility` - `public` is rejected — it is only available to official Buffer
clients.

#### UpdateSnippetInput

Input for the updateSnippet mutation. Both name and text are replaced.

**Fields:**
- `id`: `SnippetId!` - The snippet to update.
- `name`: `String!` - The new display name of the snippet.
- `organizationId`: `OrganizationId!` - The organization that owns the snippet.
- `text`: `String!` - The new hashtags, as the text that is inserted into a post.

#### UpdateTagInput

Input for updating a tag.

**Fields:**
- `id`: `TagId!` - The tag to update. Its organization is taken from the tag itself, and the
caller must be an administrator of that organization.
- `tag`: `TagToUpdateInput!` - The name and color to set on the tag.

#### UserTagInput

User tag in the image

**Fields:**
- `handle`: `String!` - The handle (username) of the account to tag, without the leading @.
- `x`: `Float!` - Horizontal position of the tag as a normalized decimal float between 0.0 and 1.0 - the fraction of the image width from the left edge (0.5 is the horizontal center). Pass a number, not a string, and do not use pixel coordinates; to convert, divide the pixel X by the image width.
- `y`: `Float!` - Vertical position of the tag as a normalized decimal float between 0.0 and 1.0 - the fraction of the image height from the top edge (0.5 is the vertical center). Pass a number, not a string, and do not use pixel coordinates; to convert, divide the pixel Y by the image height.

#### VideoAssetInput

Video asset

**Fields:**
- `metadata`: `VideoMetadataInput` - Video specific metadata
- `thumbnailUrl`: `String` - Do not use: social networks do not accept custom video thumbnail images, and
the API rejects video assets that set this field. To choose the video
thumbnail, set `metadata.thumbnailOffset` to select a frame from the video
(supported for Instagram, TikTok, and Pinterest only).
- `url`: `String!` - URL to the file source

#### VideoMetadataInput

Video metadata

**Fields:**
- `thumbnailOffset`: `Int` - Offset of the thumbnail chosen for the video, in ms
- `title`: `String` - Video title

#### YoutubePostMetadataInput

Youtube post metadata

**Fields:**
- `categoryId`: `String` - Youtube Category ID, one ID of this list:
ID: 1 -> Film & Animation
ID: 2 -> Autos & Vehicles
ID: 10 -> Music
ID: 15 -> Pets & Animals
ID: 17 -> Sports
ID: 19 -> Travel & Events
ID: 20 -> Gaming
ID: 22 -> People & Blogs
ID: 23 -> Comedy
ID: 24 -> Entertainment
ID: 25 -> News & Politics
ID: 26 -> Howto & Style
ID: 27 -> Education
ID: 28 -> Science & Technology
ID: 29 -> Nonprofits & Activism

Required on create; optional on edit (omitted preserves existing value).
- `embeddable`: `Boolean` - Indicates whether the video allows embedding (default: true)
- `isAiGenerated`: `Boolean` - Whether the post discloses AI-generated content
- `license`: `YoutubeLicense` - Video license (default: youtube)
- `madeForKids`: `Boolean` - Indicates whether the video is suitable for kids (default: false)
- `notifySubscribers`: `Boolean` - Indicates whether to notify subscribers on publish video (default: true)
- `privacy`: `YoutubePrivacy` - Privacy setting for post (default: public)
- `title`: `String` - Title of the Youtube post. Required on create; optional on edit (omitted preserves existing value).

## Interfaces

#### Asset

Asset interface with common fields

**Fields:**
- `id`: `ID` - The ID of the asset in the database
- `mimeType`: `String!` - The MIME type of the asset
- `source`: `String!` - URL to the file source
- `thumbnail`: `String!` - URL to the static thumbnail of the asset
- `type`: `AssetType!` - The type of the asset

#### CommonPostMetadata

Common properties for all post metadata types

**Fields:**
- `annotations`: `[Annotation!]!` - Annotations representing entities in the text
- `type`: `PostType!` - The channel-specific type of the post, eg, post, story, reel for Instagram

#### MutationError

Base Mutation Error type

**Fields:**
- `message`: `String!` - Error message

#### MutationSuccess

Base Mutation Success type
Used when we have a success response with no data, we return this type with empty string

**Fields:**
- `_empty`: `String!` - The value is alwaus an empty string ''
Note: GraphQL doesn't allow types with no fields, so we have to add this field

#### ScrapedLink

Link data for link preview

**Fields:**
- `text`: `String!` - Description for the scraped link
- `thumbnails`: `[String!]!` - Thumbnails of media available in the link
- `url`: `String!` - URL that the link asset has been built from

#### ThreadedPostMetadata

Common properties for all posts that support threaded replies.
See ThreadedPost for more details.

**Fields:**
- `thread`: `[ThreadedPost!]!` - The list of threaded posts (not paginated)
- `threadCount`: `Int!` - The number of threaded posts

#### ValidationRule

A validation rule constraining how a content property may be used. Each
concrete rule carries only the fields it needs; new constraint kinds are
additive (a new type implementing this interface). Clients switch on
`__typename`.

**Status:** ⚠️ Experimental

**Fields:**
- `property`: `ContentProperty!` - The content property this rule constrains.

## Unions

#### AddPostToContentItemPayload

All possible responses for addPostToContentItem.

**Possible types:** AddPostToContentItemSuccess | VoidMutationError

#### ChannelMetadata

Metadata or settings about the channel depending on the service type

**Possible types:** InstagramMetadata | TiktokMetadata | YoutubeMetadata | PinterestMetadata | MastodonMetadata | BlueskyMetadata | GoogleBusinessMetadata | FacebookMetadata | TwitterMetadata | LinkedInMetadata | WhatsAppMetadata

#### ContentItemBody

A content item's content: its channel-less draft while it is a draft, or its
channel-specific posts once it holds posts. The body shows one or the other,
never both, although a content item keeps its draft after it becomes posts.

**Possible types:** DraftContent | PostContent

#### CreateContentItemDraftPayload

All possible responses for createContentItemDraft.

**Possible types:** CreateContentItemDraftSuccess | CreateContentItemDraftFailure

#### CreateContentItemError

A recoverable error that prevented a content item from being created. Variant
errors identify the specific channel they apply to; the others apply to the
request as a whole.

**Possible types:** InvalidInputError | NotFoundError | LimitReachedError | CreateContentItemVariantInvalidInputError | CreateContentItemVariantLimitReachedError | CreateContentItemVariantNotFoundError

#### CreateContentItemPayload

All possible responses for createContentItem.

**Possible types:** CreateContentItemSuccess | CreateContentItemFailure

#### CreateIdeaPayload

createIdea response (including errors)

**Possible types:** Idea | IdeaResponse | InvalidInputError | UnauthorizedError | UnexpectedError | LimitReachedError

#### CreatePostTemplatePayload

Result of an end user creating a post template.

**Possible types:** CreatePostTemplateSuccess | VoidMutationError

#### CreateSnippetPayload

All possible responses for createSnippet. VoidMutationError reports an
empty or too long name or text.

**Possible types:** CreateSnippetSuccess | VoidMutationError

#### CreateTagPayload

The result of `createTag`: the tag that was created, or the reason it was
refused.

**Members on the way out.** `RestProxyError`, `NotFoundError`,
`UnauthorizedError` and `UnexpectedError` are being removed from this union. No
new operation should select them by name.

`RestProxyError` is never returned. The other three describe situations a caller
cannot correct — the tag not existing, the caller not being permitted, an
unexpected fault — and will be reported in the response's top-level `errors`
array instead of here.

Select `... on MutationError { message }` rather than naming concrete error
types. Every error member implements that interface, so the selection keeps
working across the change.

**Possible types:** TagActionSuccess | InvalidInputError | DuplicateError | LimitReachedError | NotFoundError | UnauthorizedError | UnexpectedError | RestProxyError

#### DeleteContentItemPayload

All possible responses for deleteContentItem.

**Possible types:** EmptySuccess | DeleteContentItemFailure

#### DeletePostPayload

All possible response types for the deletePost mutation.

**Possible types:** DeletePostSuccess | VoidMutationError

#### DeletePostTemplatePayload

Result of an end user deleting a post template.

**Possible types:** EmptySuccess | VoidMutationError

#### DeleteSnippetPayload

All possible responses for deleteSnippet.

**Possible types:** DeleteSnippetSuccess | VoidMutationError

#### DeleteTagPayload

The result of `deleteTag`: the id of the deleted tag, or the reason the delete
was refused.

**Members on the way out.** `RestProxyError`, `NotFoundError`,
`UnauthorizedError` and `UnexpectedError` are being removed from this union. No
new operation should select them by name.

`RestProxyError` is never returned. The other three describe situations a caller
cannot correct — the tag not existing, the caller not being permitted, an
unexpected fault — and will be reported in the response's top-level `errors`
array instead of here.

Select `... on MutationError { message }` rather than naming concrete error
types. Every error member implements that interface, so the selection keeps
working across the change.

**Possible types:** DeleteTagActionSuccess | InvalidInputError | NotFoundError | UnauthorizedError | UnexpectedError | RestProxyError

#### EngagementMetadata

Network-specific engagement metadata. Single-member union for now; grows
additively as more networks contribute their own shape.

**Possible types:** GoogleBusinessEngagementMetadata

#### GoogleBusinessPostDetails

GoogleBusiness Metadata details

**Possible types:** GoogleBusinessWhatsNewMetaData | GoogleBusinessOfferMetaData | GoogleBusinessEventMetaData

#### InstagramAudioCatalogPayload

Combined Instagram audio results or a request to refresh the channel.

**Possible types:** InstagramAudioCatalogSuccess | ChannelRefreshRequired

#### InstagramAudioPayload

Payload returned when refreshing Instagram audio metadata

**Possible types:** InstagramAudioSuccess | ChannelRefreshRequired

#### MovePostInQueuePayload

All possible response types that can be returned by movePostInQueue mutation.

**Possible types:** PostActionSuccess | VoidMutationError

#### PostActionPayload

Create post's request response payload.

**Possible types:** PostActionSuccess | NotFoundError | UnauthorizedError | UnexpectedError | RestProxyError | LimitReachedError | InvalidInputError

#### PostMetadata

Post metadata union type. Contains all possible types of post metadata.

**Possible types:** InstagramPostMetadata | FacebookPostMetadata | LinkedInPostMetadata | TwitterPostMetadata | PinterestPostMetadata | GoogleBusinessPostMetadata | YoutubePostMetadata | MastodonPostMetadata | TiktokPostMetadata | ThreadsPostMetadata | BlueskyPostMetadata | SubstackPostMetadata

#### PromoteContentItemDraftToPostsError

A recoverable error that prevented a content item draft from being
promoted. Post errors identify the specific channel they apply to; the
others apply to the request as a whole.

**Possible types:** ContentItemStateError | InvalidInputError | PostChannelNotFoundError | PostInvalidInputError | PostLimitReachedError

#### PromoteContentItemDraftToPostsPayload

All possible responses for promoteContentItemDraftToPosts.

**Possible types:** PromoteContentItemDraftToPostsSuccess | PromoteContentItemDraftToPostsFailure

#### ReactionVisual

How to render a reaction. The client switches on `__typename` purely as a
render strategy (built-in icon vs network image) — never on the network or the
reaction identity.

**Possible types:** IconVisual | ImageVisual

#### RemovePostFromContentItemPayload

All possible responses for removePostFromContentItem.

**Possible types:** RemovePostFromContentItemSuccess | VoidMutationError

#### SearchInstagramAudioPayload

Payload returned when searching Instagram audio

**Possible types:** SearchInstagramAudioSuccess | ChannelRefreshRequired

#### UpdateContentItemDraftError

A recoverable error that prevented a content item draft from being updated.

**Possible types:** InvalidInputError | ContentItemStateError

#### UpdateContentItemDraftPayload

All possible responses for updateContentItemDraft.

**Possible types:** UpdateContentItemDraftSuccess | UpdateContentItemDraftFailure

#### UpdateContentItemPayload

All possible responses for updateContentItem.

**Possible types:** UpdateContentItemSuccess | UpdateContentItemFailure

#### UpdatePostTemplatePayload

Result of an end user updating a post template.

**Possible types:** UpdatePostTemplateSuccess | VoidMutationError

#### UpdateSnippetPayload

All possible responses for updateSnippet. VoidMutationError reports an
empty or too long name or text.

**Possible types:** UpdateSnippetSuccess | VoidMutationError

#### UpdateTagPayload

The result of `updateTag`: the tag as it now stands, or the reason the edit was
refused.

**Members on the way out.** `RestProxyError`, `NotFoundError`,
`UnauthorizedError` and `UnexpectedError` are being removed from this union. No
new operation should select them by name.

`RestProxyError` is never returned. The other three describe situations a caller
cannot correct — the tag not existing, the caller not being permitted, an
unexpected fault — and will be reported in the response's top-level `errors`
array instead of here.

Select `... on MutationError { message }` rather than naming concrete error
types. Every error member implements that interface, so the selection keeps
working across the change.

**Possible types:** TagActionSuccess | InvalidInputError | DuplicateError | NotFoundError | UnauthorizedError | UnexpectedError | RestProxyError

## Enums

#### AiFeature

AI features supported for an engagement type. Grows additively.

**Status:** ⚠️ Experimental

**Values:**
- `insights`
- `suggestions`

#### AnnotationType

List of possible types for an annotation

**Values:**
- `annotation`
- `bold`
- `bulletedListItem`
- `cashtag`
- `hashtag`
- `heading`
- `italic`
- `mention`
- `orderedListItem`
- `strikethrough`
- `url`

#### AssetType

Asset types

**Values:**
- `document`
- `image`
- `video`

#### AuthorizationStatus

Represents the authorization evaluation result for a feature.

**Status:** ⚠️ Experimental

**Values:**
- `needsRefresh` - Authorization exists but requires token refresh
- `needsUpgrade` - The client version is below the minimum required to access this feature.
The client should prompt the user to upgrade.
- `notEnoughData` - Insufficient data to determine authorization state.
Typically indicates missing scopes or webhook metadata.
- `notEnoughRights` - The connected platform user's role/permissions are insufficient for this
feature, so reconnecting with the same user cannot fix it. Clients should
prompt the user to contact an administrator of the platform account (or
have one connect the channel) instead of offering a reconnect.
- `ok` - Authorization is valid and the feature can be used.

#### ChannelAction

List of possible actions that can be performed on a Channel

**Values:**
- `approvePosts`
- `backfillChannel`
- `exportInsights`
- `interactWithTakeaways`
- `manageCapabilities`
- `manageChannelSettings`
- `manageComments`
- `manageDms`
- `manageIntegrations`
- `managePostingSchedule`
- `manageUpdates`
- `publishStartPage`
- `readUpdates`
- `reconnectChannel`
- `removeChannel`
- `scheduleUpdates`
- `viewCapabilities`
- `viewChannel`
- `viewComments`
- `viewDms`
- `viewInsights`
- `viewPublish`
- `viewUpdates` *(Deprecated: Renamed to `viewPublish`. Still emitted for backward-compat with clients that gate on `viewUpdates`; use `viewPublish` to gate the Publish UI or `readUpdates` to gate reading post data. Will be removed once no client reads it.)*

#### ChannelType

Channel is a representation of a social media account or page that can be connected to Buffer.

**Values:**
- `account`
- `business`
- `channel`
- `group`
- `page`
- `profile`

#### ConfigurationContentType

The kinds of content a channel can compose. Grows additively.

**Status:** ⚠️ Experimental

**Values:**
- `comment`
- `post`
- `reel`
- `story`

#### ConnectedAppCategory

The category of a connected app.

**Values:**
- `mcp` - An MCP client connection.

#### ContentItemAction

Actions the calling actor can take on a `ContentItem`. The server computes
this set from the same rules the content item mutations enforce. A client
reads it to drive UI affordances instead of deriving the rules itself.

The set carries an action only when a client can offer it on this one item.
An action whose answer is the same for every item in a response drives no
affordance, so it stays out. Read access is one of those: the API returns
only a content item the actor may read.

**Status:** ⚠️ Experimental

**Values:**
- `deleteContentItem` - The actor can delete this content item. An item that holds channel-specific
posts gets a second check. The mutation checks each post, so a delete can
still fail.
- `updateContentItem` - The actor can change this content item's title and target date. The actor
can also change the tags and the draft text while the item holds a
channel-less draft.

#### ContentItemSortableKey

Field to sort content items by.

**Status:** ⚠️ Experimental

**Values:**
- `targetDate` - Sort by the content item's target date, the date it is planned for. Content
items with no target date sort first in ascending order.
- `createdAt` - Sort by the date the content item was created.

#### ContentItemStatus

The status of a content item's body.

**Status:** ⚠️ Experimental

**Values:**
- `draftContent` - The content item holds a channel-less draft.
- `postContent` - The content item holds channel-specific posts.

#### ContentProperty

A property a content type can carry. Support is expressed by inclusion in
`supportedProperties` — there are no exclusion lists. Grows additively.

**Status:** ⚠️ Experimental

**Values:**
- `board`
- `document`
- `firstComment`
- `gif`
- `image`
- `imageAltText`
- `linkAttachment`
- `retweetAttachment`
- `text`
- `thread`
- `video`

#### DateTimePresence

Presence filter for nullable date fields.
When filtering the same field, absent dates cannot also match a date comparator range.

**Values:**
- `absent` - Include results where the date field is missing or null
- `present` - Include results where the date field exists and is not null

#### DayOfWeek

Day of the week.

**Values:**
- `fri`
- `mon`
- `sat`
- `sun`
- `thu`
- `tue`
- `wed`

#### EngagementType

Discriminator used in inputs/filters to scope a query to specific types.

**Status:** ⚠️ Experimental

**Values:**
- `comment` - Fetch comments (direct replies to Buffer-managed posts).
- `mention` - Fetch mentions (references to the account across the network).

#### Feature

A capability a channel can expose, spanning every domain. The shared key for
per-channel `authorizationStatus`. Grows additively.

**Status:** ⚠️ Experimental

**Values:**
- `comment`
- `directMessage`
- `engagementReaction`
- `insights`
- `mention`
- `posting`

#### GoogleBusinessPostActionType

List of possible types for GBP cta

**Values:**
- `book`
- `call`
- `learn_more`
- `none`
- `order`
- `shop`
- `signup`

#### IdeaGroupMembership

Named buckets for filtering ideas by their group membership.

**Values:**
- `grouped` - Only ideas that are assigned to a group.
- `ungrouped` - Only ideas that are not assigned to any group.

#### InstagramAudioType

Instagram audio catalog type from Meta's Audio API.

**Status:** ⚠️ Experimental

**Values:**
- `music` - Licensed music from Meta's audio catalog.
- `originalSound` - Audio created by an Instagram account.

#### MediaFormat

Media formats a `FormatRule` can allow-list. Grows additively.

**Status:** ⚠️ Experimental

**Values:**
- `gif`
- `jpeg`
- `mov`
- `mp4`
- `pdf`
- `png`
- `webm`

#### MediaType

The type of media attached to a post

**Values:**
- `image`
- `gif`
- `video`
- `link`
- `document`
- `unsupported`

#### NoteAction

List of possible actions that can be performed on a note

**Values:**
- `deleteNote` - The user can delete the note.
- `reactToNote` - The user can add or remove their emoji reactions on the note.
- `updateNote` - The user can update the note.

#### NoteType

The type of a note.

**Values:**
- `aiGenerated` - A note that was generated by our AI system.
- `bufferGenerated` - A note that was generated by our internal system. Can be used for approval flows notifications or other automated processes.
- `userGenerated` - A note that was manually written by a user.

#### NotificationStatus

List of possible statuses for a notification

**Values:**
- `markedAsPublished`
- `notified`

#### PostAction

List of possible actions that can be performed on a Post

**Values:**
- `addPostNote`
- `addPostToQueue`
- `approvePost`
- `cancelPostRecurrence`
- `copyPostLink`
- `createPostRecurrence`
- `deletePost`
- `duplicatePost`
- `editPostRecurrence`
- `movePostToDraft`
- `publishPostNext`
- `publishPostNow`
- `rejectPost`
- `removePostScheduledTime`
- `requestPostApproval`
- `revertPostApprovalRequest`
- `sharePostLink`
- `updatePost`
- `updatePostSchedule`
- `updatePostTags`
- `updateShopGridLink`
- `viewPost`

#### PostApprovalChange

A change to a post's approval state, for a post that is already a draft.

**Values:**
- `request` - Submit the draft for approval.
- `revert` - Withdraw a pending approval request, returning the post to a plain draft.

#### PostingGoalStatus

PostingGoalStatus is used to track the status of a posting goal.

**Values:**
- `AtRisk`
- `Hit`
- `OnTrack`

#### PostMetricType

List of possible metrics available for a Post.

Values fall into three groups:
- **Cross-network normalized** (reactions, comments, shares, reposts, reach, impressions, views, clicks, engagementRate): Used wherever a concept maps cleanly across networks. Per-network adapters normalize their native names (e.g., Instagram `likes` → `reactions`, Twitter `retweets` → `reposts`).
- **Network-specific** (saves, follows, quotes, viewers, totalTimeWatched, averageTimeWatched, likes, freeSubscriptions, paidSubscriptions): Real metrics that don't have a cross-network equivalent. `likes` is intentionally distinct from `reactions` on Facebook — Facebook's Graph API surfaces them separately. `freeSubscriptions` and `paidSubscriptions` are Substack's per-Note subscription attribution; no other network reports it.
- **Aggregation-only** (postCount): Meaningful only on aggregate endpoints; never emitted per-post.

Deprecated values are pre-normalization legacy or tied to features being removed. They're kept in the enum for backwards compatibility until clients migrate.

**Values:**
- `averageTimeWatched` - Average time watched, in seconds, for video-style posts (TikTok, Instagram Reels).
- `clicks` - How many times people clicked on your post.
- `comments` - The count of comments and replies on your post. Unified across networks (Threads `replies` maps here).
- `engagementRate` - The percentage of people who interacted with your post compared to how many saw it. Unit: percentage.
- `favorites` - Deprecated: not emitted by any per-network definition. Use `reactions` instead — Twitter and Mastodon favorites normalize into `reactions`. Will be removed on 2026-12-01. *(Deprecated: Not emitted by any per-network definition; use `reactions` instead. Will be removed on 2026-12-01.)*
- `follows` - The number of new followers gained from this post (Instagram).
- `freeSubscriptions` - The number of free subscriptions Substack attributes to this Note. *(⚠️ Experimental)*
- `impressions` - How many times your post was shown on screen. May include multiple views by the same person — useful for spotting how often the content gets surfaced.
- `likes` - The Like-reaction subcount on Facebook. Distinct from `reactions` (which is the total of all reaction types — Like, Love, Care, Haha, Wow, Sad, Angry); Facebook's Graph API reports them separately and we mirror that.
- `link_clicks` - Deprecated: StartPage link-clicks metric. StartPage is being deprecated as a product. Will be removed on 2026-12-01. *(Deprecated: StartPage is being deprecated as a product. Will be removed on 2026-12-01.)*
- `other` - Deprecated catch-all from pre-normalization. Never emitted. Will be removed on 2026-12-01. *(Deprecated: Catch-all from pre-normalization; never emitted. Will be removed on 2026-12-01.)*
- `paidSubscriptions` - The number of paid subscriptions Substack attributes to this Note. *(⚠️ Experimental)*
- `postCount` - The count of posts included in an aggregated response. Only meaningful on aggregate endpoints — never emitted per-post.
- `quotes` - How many times your post was quoted (Threads).
- `reach` - The number of unique people who saw your post.
- `reactions` - How many people reacted to your post. Unified across networks: Instagram/Twitter `likes`, Mastodon `favorites`, etc. all map to this value.
- `reblogs` - Deprecated: not emitted by any per-network definition. Use `reposts` instead — Mastodon reblogs normalize into `reposts`. Will be removed on 2026-12-01. *(Deprecated: Not emitted by any per-network definition; use `reposts` instead. Will be removed on 2026-12-01.)*
- `repins` - Deprecated: not emitted by any per-network definition. Pre-normalization legacy from the Pinterest era. Will be removed on 2026-12-01. *(Deprecated: Not emitted by any per-network definition. Will be removed on 2026-12-01.)*
- `replies` - Deprecated: not emitted by any per-network definition. Use `comments` instead — replies are normalized into `comments` on the networks that distinguish them (Threads). Will be removed on 2026-12-01. *(Deprecated: Not emitted by any per-network definition; use `comments` instead. Will be removed on 2026-12-01.)*
- `reposts` - How many times your post was reposted by others. Twitter `retweets`, Mastodon `reblogs`, Threads `reposts` all normalize to this value.
- `retweets` - Deprecated: not emitted by any per-network definition. Use `reposts` instead — Twitter retweets normalize into `reposts`. Will be removed on 2026-12-01. *(Deprecated: Not emitted by any per-network definition; use `reposts` instead. Will be removed on 2026-12-01.)*
- `saves` - How many times people saved your post (Instagram, Pinterest). A strong signal that the content is worth revisiting.
- `shares` - How many times your post was shared or forwarded by others.
- `totalTimeWatched` - Total time watched, in minutes, for video-style posts (LinkedIn, TikTok, Instagram Reels).
- `viewers` - Unique viewer count for video-style posts (LinkedIn).
- `views` - How many times your post was viewed. Used for video-style posts and on networks that report views distinctly from impressions.

#### PostMetricUnit

The unit representing the value of a PostMetric.

**Values:**
- `count` - An integer count (e.g. number of reactions, impressions, reach).
- `percentage` - A percentage value between 0 and 100 (e.g. engagement rate).

#### PostSortableKey

Key of collection to use for sorting

**Values:**
- `dueAt` - Sort by the post's dueAt field.
Due at is the date when the post is scheduled to be published.
- `createdAt` - Sort by the post's createdAt field.
Created at is the date when the post was created.

#### PostStatus

List of possible statuses for a Post

**Values:**
- `draft`
- `error`
- `needs_approval`
- `scheduled`
- `sending`
- `sent`

#### PostTemplateVisibility

The visibility level of a post template. `public` is reserved for
Buffer-curated templates; setting it is only available to official
Buffer clients.

**Status:** 🧪 Preview

**Values:**
- `internal` - All members of the template's organization can access this template.
- `private` - Only the creator can access this template.
- `public` - Anyone across all organizations can access this template. Reserved
for Buffer-curated templates — `createPostTemplate` and
`updatePostTemplate` reject this value; setting it is only available
to official Buffer clients. It appears in read results.

#### PostType

List of possible types for a Post. Some services may have different types (e.g., Instagram has story, reel, post but Twitter has only post)

**Values:**
- `carousel`
- `event`
- `ghost_post`
- `offer`
- `post`
- `reel`
- `short`
- `story`
- `thread`
- `whats_new`

#### PostTypeFacebook

List of specific post types available for Facebook

**Values:**
- `post`
- `reel`
- `story`

#### PostTypeGoogleBusiness

List of specific post types available for Google Business profiles

**Values:**
- `event`
- `offer`
- `whats_new`

#### PostVia

List of possible ways to create a Post

**Values:**
- `api`
- `buffer`
- `network`

#### Product

Buffer products, buffer is used as all products

**Values:**
- `analyze`
- `buffer`
- `comments`
- `engage`
- `publish`
- `startPage`

#### QueuePosition

Target position within a channel's queue that a post can be moved to.

**Status:** ⚠️ Experimental

**Values:**
- `bottom` - Move the post to the bottom of the queue, taking the last slot.
- `top` - Move the post to the top of the queue, taking the next available slot.

#### ReactionIcon

Standard reaction icon set used by `IconVisual`. Grows additively.

**Status:** ⚠️ Experimental

**Values:**
- `heart`
- `star`
- `thumbsUp`

#### ReactionType

Types of reactions that can be applied to a comment.

**Status:** ⚠️ Experimental

**Values:**
- `celebrate` - A celebrate reaction. Supported only for LinkedIn comments.
- `external` - An external reaction on the comment, using an external link.
- `funny` - A funny reaction. Supported only for LinkedIn comments.
- `insightful` - An insightful reaction. Supported only for LinkedIn comments.
- `like` - A like reaction on the comment.
- `love` - A love reaction. Supported only for LinkedIn comments.
- `support` - A support reaction. Supported only for LinkedIn comments.

#### ScheduleOption

**Values:**
- `Queue`
- `Prioritize`
- `FixedTime`
- `Now`

#### SchedulingType

Indicates whether the post was scheduled for notification publishing or automatic publishing

**Values:**
- `automatic` - Buffer's publishing workers send the post, with nobody having to act
- `notification` - Buffer reminds someone to publish the post by hand

#### Service

The list of services that can be authorized.

**Values:**
- `bluesky`
- `facebook`
- `googlebusiness`
- `instagram`
- `linkedin`
- `mastodon`
- `pinterest`
- `startPage`
- `substack`
- `threads`
- `tiktok`
- `twitter`
- `whatsapp`
- `youtube`

#### ShareMode

How the post is being scheduled.

**Values:**
- `addToQueue`
- `customScheduled`
- `shareNext`
- `shareNow`

#### SortDirection

Direction to sort the results by.

**Values:**
- `asc` - Sort records in ascending order.
- `desc` - Sort records in descending order.

#### SyncDataMechanism

How items of an engagement type are pulled / pushed. `realTime` covers push
(webhook / firehose); `polling` is pull.

**Status:** ⚠️ Experimental

**Values:**
- `polling`
- `realTime`

#### TagColorName

Stable Buffer identifiers for the supported tag color palette.
Clients map these values to platform- and theme-specific presentation.
Values ending in `Light` are lighter palette variants, not UI theme modes.

**Values:**
- `blue` - The standard blue palette color.
- `blueLight` - The lighter blue palette color.
- `gray` - The standard gray palette color.
- `grayLight` - The lighter gray palette color.
- `green` - The standard green palette color.
- `greenLight` - The lighter green palette color.
- `orange` - The standard orange palette color.
- `orangeLight` - The lighter orange palette color.
- `pink` - The standard pink palette color.
- `pinkLight` - The lighter pink palette color.
- `purple` - The standard purple palette color.
- `purpleLight` - The lighter purple palette color.
- `red` - The standard red palette color.
- `redLight` - The lighter red palette color.
- `teal` - The standard teal palette color.
- `tealLight` - The lighter teal palette color.
- `yellow` - The standard yellow palette color.
- `yellowLight` - The lighter yellow palette color.

#### YoutubeLicense

List of license types

**Values:**
- `creativeCommon`
- `youtube`

#### YoutubePrivacy

List of privacy types

**Values:**
- `private`
- `public`
- `unlisted`

## Scalars

#### AccountId

The `AccountId` scalar represents the ID of a Buffer Account

**Identifies:** Account

#### ChannelId

The `ChannelId` scalar represents the ID of a Buffer Channel

**Identifies:** Channel

#### ContentItemId

A unique identifier for a content item.

**Identifies:** ContentItem

#### DateTime

The `DateTime` scalar represents a date and time following the ISO 8601 standard.

#### DraftContentId

A unique identifier for a channel-less draft's content.

**Identifies:** DraftContent

#### DraftId

The `DraftId` scalar represents the ID of a Buffer Draft

#### Email

The `Email` scalar represents a valid, normalized email address.
Input is trimmed and lowercased before validation.

#### IdeaId

The `IdeaId` scalar represents the ID of a Buffer Idea

**Identifies:** Idea

#### InvitationId

The `InvitationId` scalar represents the ID of a pending team invitation

#### NoteId

The `NoteId` scalar represents the ID of a Buffer Note

**Identifies:** Note

#### OrganizationId

The `OrganizationId` scalar represents the ID of a Buffer Organization

**Identifies:** Organization

#### PostId

The `PostId` scalar represents the ID of a Buffer Post

**Identifies:** Post

#### PostTemplateId

The `PostTemplateId` scalar represents the ID of a Post Template.

**Identifies:** PostTemplate

#### SnippetId

The `SnippetId` scalar represents the ID of a Snippet.

**Identifies:** Snippet

#### TagId

The `TagId` scalar represents the ID of a Buffer Tag

**Identifies:** Tag

#### URL

The `URL` scalar represents a valid URL

#### Uuid

The `Uuid` scalar represents an RFC 4122 v4 UUID,
e.g. `550e8400-e29b-41d4-a716-446655440000`.
