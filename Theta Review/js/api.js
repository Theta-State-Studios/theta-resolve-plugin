class ReviewPortalAPI {
    async getReviewsGroupedByClient() {
        const data = await window.theta.getReviews();

        if (data.error) {
            return { error: data.error, clients: [] };
        }

        const rawReviews = Array.isArray(data) ? data : data.reviews || [];
        const clientMap = {};

        for (const review of rawReviews) {
            const clientName = review.clientName || this.extractClientName(review.name || "");
            if (!clientName) continue;

            if (!clientMap[clientName]) {
                clientMap[clientName] = {
                    name: clientName,
                    reviews: [],
                    reviewCount: 0,
                    editingCount: 0,
                };
            }

            const status = this.normalizeStatus(review.status || "");

            clientMap[clientName].reviews.push({
                key: review.jiraKey || "",
                shortName: this.extractReviewName(review.name || ""),
                status,
                statusLabel: this.getStatusLabel(status),
                reviewToken: review.token || null,
                reviewUrl: review.url || null,
                deliverables: (review.deliverables || []).map((d) => {
                    const delStatus = this.normalizeDeliverableStatus(d.status || "");
                    return {
                        id: d.id || null,
                        label: d.label || d.name || "Untitled",
                        version: d.version || 0,
                        video: d.video || null,
                        commentCount: d.commentCount || 0,
                        status: delStatus,
                        statusLabel: this.getDeliverableStatusLabel(delStatus),
                    };
                }),
            });

            clientMap[clientName].reviewCount++;
            if (status === "editing") {
                clientMap[clientName].editingCount++;
            }
        }

        const clients = Object.values(clientMap).sort((a, b) => a.name.localeCompare(b.name));
        return { clients, error: null };
    }

    extractClientName(name) {
        const dashIndex = name.indexOf(" - ");
        if (dashIndex > 0) return name.substring(0, dashIndex).trim();
        return name;
    }

    extractReviewName(name) {
        const dashIndex = name.indexOf(" - ");
        if (dashIndex > 0) return name.substring(dashIndex + 3).trim();
        return name;
    }

    normalizeStatus(status) {
        const lower = status.toLowerCase();
        if (lower.includes("revision")) return "needs-edits";
        if (lower.includes("needs edit")) return "needs-edits";
        if (lower.includes("client review")) return "client-review";
        if (lower.includes("internal review") || lower.includes("in review")) return "in-review";
        if (lower.includes("edit") && !lower.includes("needs")) return "editing";
        if (lower.includes("approved") || lower.includes("done") || lower.includes("complete")) return "approved";
        return "waiting";
    }

    getStatusLabel(status) {
        const labels = {
            waiting: "Waiting",
            editing: "Editing",
            "in-review": "In Review",
            "needs-edits": "Needs Edits",
            "client-review": "Client Review",
            approved: "Approved",
        };
        return labels[status] || "Unknown";
    }

    normalizeDeliverableStatus(status) {
        switch (status) {
            case "internal_review": return "in-review";
            case "client_review":   return "client-review";
            case "revisions":       return "needs-edits";
            case "approved":        return "approved";
            case "delivered":       return "approved";
            default:                return "in-review";
        }
    }

    getDeliverableStatusLabel(status) {
        const labels = {
            "in-review":     "In Review",
            "client-review": "Client Review",
            "needs-edits":   "Needs Edits",
            "approved":      "Approved",
        };
        return labels[status] || "In Review";
    }

    getStatusCounts(reviews) {
        const counts = {};
        for (const review of reviews) {
            const label = review.statusLabel;
            counts[label] = (counts[label] || 0) + 1;
        }
        return Object.entries(counts)
            .map(([label, count]) => `${count} ${label.toLowerCase()}`)
            .join(" \u00b7 ");
    }
}
