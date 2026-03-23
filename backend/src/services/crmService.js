import axios from "axios";

export async function pushLeadToCRM(connection, lead) {
  if (connection.provider === "hubspot") {
    await axios.post(
      "https://api.hubapi.com/crm/v3/objects/contacts",
      {
        properties: {
          email: lead.email,
          firstname: lead.name,
          company: lead.company,
          website: lead.website,
        },
      },
      {
        headers: { Authorization: `Bearer ${connection.accessToken}` },
      }
    );
    return;
  }

  if (connection.provider === "pipedrive") {
    const endpoint = connection.endpointUrl || "https://api.pipedrive.com/v1/persons";
    await axios.post(endpoint, {
      name: lead.name,
      email: lead.email,
      org_name: lead.company,
      visible_to: 3,
      api_token: connection.accessToken,
    });
    return;
  }

  if (connection.provider === "salesforce") {
    if (!connection.endpointUrl) {
      throw new Error("Salesforce requires endpointUrl");
    }
    await axios.post(
      connection.endpointUrl,
      {
        LastName: lead.name,
        Company: lead.company,
        Email: lead.email,
      },
      {
        headers: { Authorization: `Bearer ${connection.accessToken}` },
      }
    );
  }
}