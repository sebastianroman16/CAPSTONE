export type CredentialDelivery = "DELIVERED" | "PENDING" | "FAILED";

/**
 * La clave temporal solo vuelve a la pantalla del abogado si el envío no se completó.
 * Si el proveedor la entregó por correo, no se expone en la respuesta.
 */
export function credentialsForLawyer(temporaryPassword: string, deliveryStatus: CredentialDelivery) {
  return deliveryStatus === "DELIVERED" ? { deliveryStatus } : { deliveryStatus, temporaryPassword };
}

/**
 * HU-02: envía las credenciales temporales de un cliente nuevo por el webhook configurado.
 * Sin webhook queda PENDING y el abogado ve la clave temporal en pantalla para entregarla.
 */
export async function deliverClientCredentials(
  email: string,
  name: string,
  temporaryPassword: string,
): Promise<CredentialDelivery> {
  const url = process.env.CLIENT_CREDENTIALS_WEBHOOK_URL;
  if (!url) return "PENDING";
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        to: email,
        template: "client-welcome",
        name,
        temporaryPassword,
        loginUrl: `${process.env.FRONTEND_ORIGIN || "http://localhost:4200"}/iniciar-sesion`,
      }),
    });
    return response.ok ? "DELIVERED" : "FAILED";
  } catch {
    return "FAILED";
  }
}
