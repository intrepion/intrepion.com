import { Code, ConnectError } from "@connectrpc/connect";
import { compatibilityClient } from "./client.ts";

const form = document.querySelector<HTMLFormElement>("#ping-form")!;
const name = document.querySelector<HTMLInputElement>("#client-name")!;
const format = document.querySelector<HTMLSelectElement>("#format")!;
const button = document.querySelector<HTMLButtonElement>("#send")!;
const result = document.querySelector<HTMLOutputElement>("#result")!;

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (button.disabled) return;
  button.disabled = true;
  result.textContent = "Calling the local service…";
  result.dataset.state = "pending";
  try {
    const response = await compatibilityClient(format.value === "binary").ping({
      clientName: name.value,
    });
    result.textContent = `${response.message}\nServer: ${response.server}`;
    result.dataset.state = "success";
  } catch (error) {
    const connectError = ConnectError.from(error);
    result.textContent = `${Code[connectError.code]}: ${connectError.rawMessage}`;
    result.dataset.state = "error";
  } finally {
    button.disabled = false;
  }
});
