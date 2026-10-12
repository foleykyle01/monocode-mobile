use iroh::{endpoint::presets, Endpoint, RelayMode, SecretKey};
use monocode_companion_core::{exchange, host::Host, storage::private_write, Request, VERSION};
use serde_json::{json, Value};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    net::TcpListener,
};

#[tokio::test]
async fn authenticated_transport_forwards_only_paired_devices_and_honors_revocation() {
    let directory = tempfile::tempdir().unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let descriptor = directory.path().join("descriptor.json");
    private_write(&descriptor, &json!({"version":1,"application":"com.monocode.companion-spike","endpoint":listener.local_addr().unwrap().to_string(),"token":"a".repeat(64)})).unwrap();
    let host = std::sync::Arc::new(
        Host::bind(directory.path().join("host.json"), descriptor, true)
            .await
            .unwrap(),
    );
    let addr = host.endpoint.addr();
    let serving = host.clone();
    let task = tokio::spawn(async move { serving.serve().await });
    let client = Endpoint::builder(presets::Minimal)
        .secret_key(SecretKey::generate())
        .relay_mode(RelayMode::Disabled)
        .bind()
        .await
        .unwrap();
    let command = Request::Command {
        version: VERSION,
        request_id: "same-request".into(),
        action: "sessions.list".into(),
        input: json!({}),
    };
    let denied = exchange(&client, &addr, &command).await.unwrap();
    assert_eq!(denied["ok"], false);

    let ticket = host.gate.lock().await.invite(addr.clone());
    let pair = Request::Pair {
        version: VERSION,
        invitation: ticket.invitation,
    };
    assert_eq!(exchange(&client, &addr, &pair).await.unwrap()["ok"], true);
    let client_id = client.id().to_string();
    let desktop = tokio::spawn(async move {
        let mut ids = Vec::new();
        for _ in 0..2 {
            let (stream, _) = listener.accept().await.unwrap();
            let (reader, mut writer) = stream.into_split();
            let mut line = String::new();
            BufReader::new(reader).read_line(&mut line).await.unwrap();
            let request: Value = serde_json::from_str(&line).unwrap();
            assert_eq!(request["namespace"], "companion");
            assert_eq!(request["token"], "a".repeat(64));
            assert_eq!(request["action"], "sessions.list");
            assert_eq!(request["requestId"], format!("{client_id}-same-request"));
            ids.push(request["requestId"].clone());
            writer
                .write_all(b"{\"ok\":true,\"result\":{\"epoch\":\"test\",\"sessions\":[]}}\n")
                .await
                .unwrap();
        }
        assert_eq!(ids[0], ids[1]);
    });
    for _ in 0..2 {
        assert_eq!(
            exchange(&client, &addr, &command).await.unwrap()["result"]["epoch"],
            "test"
        );
    }
    desktop.await.unwrap();
    host.gate
        .lock()
        .await
        .revoke(&client.id().to_string())
        .unwrap();
    assert_eq!(
        exchange(&client, &addr, &command).await.unwrap()["ok"],
        false
    );
    assert_eq!(exchange(&client, &addr, &pair).await.unwrap()["ok"], false);
    client.close().await;
    host.endpoint.close().await;
    task.abort();
}
