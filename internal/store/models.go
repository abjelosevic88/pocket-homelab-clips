package store

// User is an account that can sign in. The first user is the admin; admins
// manage other users. Clips are private to their owner; snippets and
// quicklinks are private unless shared.
type User struct {
	ID           int64  `json:"id"`
	Email        string `json:"email"`
	Name         string `json:"name"`
	PasswordHash string `json:"-"`
	Role         string `json:"role"` // admin | member
	CreatedAt    string `json:"created_at"`
}

// APIToken is a personal access token (hash stored, plaintext shown once).
type APIToken struct {
	ID         int64   `json:"id"`
	UserID     int64   `json:"user_id"`
	Name       string  `json:"name"`
	Prefix     string  `json:"prefix"`
	LastUsedAt *string `json:"last_used_at"`
	CreatedAt  string  `json:"created_at"`
}

// Clip kinds.
const (
	KindText  = "text"
	KindLink  = "link"
	KindColor = "color"
	KindImage = "image"
	KindFile  = "file"
)

// ValidKind reports whether k is a known clip kind.
func ValidKind(k string) bool {
	switch k {
	case KindText, KindLink, KindColor, KindImage, KindFile:
		return true
	}
	return false
}

// Clip is one entry of the clipboard history.
type Clip struct {
	ID            int64  `json:"id"`
	UserID        int64  `json:"user_id"`
	Kind          string `json:"kind"`
	Content       string `json:"content"`
	Title         string `json:"title"`
	SourceApp     string `json:"source_app"`
	SourceDevice  string `json:"source_device"`
	Bytes         int64  `json:"bytes"`
	Chars         int    `json:"chars"`
	Words         int    `json:"words"`
	Lines         int    `json:"lines"`
	Width         int    `json:"width"`
	Height        int    `json:"height"`
	Pinned        bool   `json:"pinned"`
	CopyCount     int    `json:"copy_count"`
	FirstCopiedAt string `json:"first_copied_at"`
	LastCopiedAt  string `json:"last_copied_at"`

	// Only on search results: the matching passage with <mark> tags.
	Snippet string `json:"snippet,omitempty"`
}

// Snippet is reusable text with a keyword and dynamic placeholders.
type Snippet struct {
	ID         int64   `json:"id"`
	UserID     int64   `json:"user_id"`
	OwnerName  string  `json:"owner_name"`
	Name       string  `json:"name"`
	Keyword    string  `json:"keyword"`
	Content    string  `json:"content"`
	Folder     string  `json:"folder"`
	Shared     bool    `json:"shared"`
	Pinned     bool    `json:"pinned"`
	UseCount   int     `json:"use_count"`
	LastUsedAt *string `json:"last_used_at"`
	CreatedAt  string  `json:"created_at"`
	UpdatedAt  string  `json:"updated_at"`

	// Derived: the {argument …} placeholders found in content.
	Arguments []Argument `json:"arguments"`
	Snippet   string     `json:"snippet,omitempty"`
}

// Argument is a placeholder the user fills in when a snippet or quicklink is used.
type Argument struct {
	Name    string `json:"name"`
	Default string `json:"default"`
}

// Quicklink is a URL with optional placeholders.
type Quicklink struct {
	ID         int64   `json:"id"`
	UserID     int64   `json:"user_id"`
	OwnerName  string  `json:"owner_name"`
	Name       string  `json:"name"`
	Keyword    string  `json:"keyword"`
	Link       string  `json:"link"`
	Icon       string  `json:"icon"`
	OpenWith   string  `json:"open_with"`
	Folder     string  `json:"folder"`
	Shared     bool    `json:"shared"`
	Pinned     bool    `json:"pinned"`
	UseCount   int     `json:"use_count"`
	LastUsedAt *string `json:"last_used_at"`
	CreatedAt  string  `json:"created_at"`
	UpdatedAt  string  `json:"updated_at"`

	Arguments []Argument `json:"arguments"`
}

// Settings are preferences stored as key/value pairs, shared by everyone.
type Settings struct {
	Title             string `json:"title"`
	ClipRetentionDays int    `json:"clip_retention_days"` // 0 = keep forever; pinned clips are never purged
	MaxClips          int    `json:"max_clips"`           // per user, 0 = unlimited; oldest unpinned go first
	FetchLinkTitles   bool   `json:"fetch_link_titles"`   // look up <title> of copied links
	SetupComplete     bool   `json:"setup_complete"`
}
