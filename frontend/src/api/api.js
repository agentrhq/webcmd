import axios from "axios";

const client = axios.create({
  baseURL: "/api",
  headers: { "Content-Type": "application/json" },
});

export const api = {
  health: () => client.get("/health").then((r) => r.data),

  // Profile
  getProfile: () => client.get("/profile").then((r) => r.data),
  saveProfile: (data) => client.post("/profile", data).then((r) => r.data),

  // Opportunities
  getOpportunities: () => client.get("/opportunities").then((r) => r.data),

  getRecommended: (limit = 6) =>
    client.get(`/opportunities/recommended?limit=${limit}`).then((r) => r.data),

  getOpportunity: (id) =>
    client.get(`/opportunities/${id}`).then((r) => r.data),

  // Discover live opportunities from the web
  discoverOpportunities: () =>
    client.post("/opportunities/discover").then((r) => r.data),

  //documents
getDocuments: () => client.get("/documents").then((r) => r.data),

uploadDocument: (type, file) => {
  const formData = new FormData();

  formData.append("type", type);
  formData.append("file", file);

  return client
    .post("/documents/upload", formData, {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    })
    .then((r) => r.data);
},

removeDocument: (type) =>
  client
    .delete(`/documents/${encodeURIComponent(type)}`)
    .then((r) => r.data),

  // Applications
  getApplications: () => client.get("/applications").then((r) => r.data),

  getApplication: (id) =>
    client.get(`/applications/${id}`).then((r) => r.data),

  startApplication: (opportunityId) =>
    client.post("/applications", { opportunityId }).then((r) => r.data),

  analyzeApplication: (id) =>
    client.post(`/applications/${id}/analyze`).then((r) => r.data),

  submitApplication: (id) =>
    client.post(`/applications/${id}/submit`).then((r) => r.data),
};

export default api;