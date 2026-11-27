# Jenkins and Terraform

The Jenkins controller can run on the DigitalOcean Droplet. A separate Linux agent runs the build, Postgres and Redis tests, the Compose smoke test, and the release. Terraform can run from your laptop and uses DigitalOcean's API to manage the Droplet and its Cloud Firewall.

## Jenkins

1. Copy [the controller Compose file](../jenkins/compose.yml) to a separate directory on the Droplet, such as `/opt/cambo-jenkins`, as `compose.yml`. From that directory run `docker compose up -d`. Jenkins stores its configuration in a named volume, listens on loopback port 8090, and defaults to a 512 MiB memory limit and half a CPU. Set `JENKINS_MEMORY_LIMIT` or `JENKINS_CPUS` to adjust these limits. If 8090 is occupied, set `JENKINS_HTTP_PORT` and use the new server port in the SSH forward below. On the 1 GB Droplet, check that the shop remains healthy while Jenkins starts and installs plugins.
2. Use an administrator SSH account that allows forwarding. The restricted production deploy key is for the pipeline's deploy step.

   ```bash
   ssh -N -L 8090:127.0.0.1:8090 <admin>@<droplet>
   ```

   Open `http://127.0.0.1:8090`. From the controller's directory on the Droplet, fetch the one-time setup password with `docker compose exec controller cat /var/jenkins_home/secrets/initialAdminPassword`. Install the suggested plugins and check that Pipeline, Pipeline: Declarative, Git, Credentials Binding, and SSH Credentials are installed. Set the built-in node's executor count to zero.

3. Create a permanent agent with the label `cambo-linux`, one executor, and the inbound launch method. On a Linux amd64 build machine with Java 21, start it with the command shown on its Jenkins node page, using WebSocket and the forwarded controller URL. When the build machine is separate from your browser, establish the SSH forward there too. Install Node 22 and npm, Terraform 1.5+, Git, OpenSSH client, Bash, curl, the PostgreSQL client (`psql`), Puppeteer's Chromium system libraries, and Docker with Compose 2.24.4+ and Buildx. The agent must be able to run Docker and bind the smoke test's local ports (18080, 15432, 13001, 19090). If necessary, set `JENKINS_SMOKE_WEB_PORT`, `JENKINS_SMOKE_DB_PORT`, `JENKINS_SMOKE_GRAFANA_PORT`, and `JENKINS_SMOKE_PROMETHEUS_PORT` in the agent environment.
4. Create a **Pipeline** job with **Pipeline script from SCM**, your GitHub repository URL, branch `*/main` and script path `Jenkinsfile`. Use a trusted main-only job for release credentials. Run it once with **RELEASE unchecked**. It validates Terraform without cloud credentials, runs the test suites with temporary Postgres and Redis containers, builds the app, and tests the Compose stack. After the first run, Jenkins polls GitHub every five minutes for new commits on `main` and runs the checks automatically.

   [Jenkins Docker installation](https://www.jenkins.io/doc/book/installing/docker/) · [Jenkins agents](https://www.jenkins.io/doc/book/using/using-agents/)

### Release from Jenkins

Add the following credentials to the Jenkins job's folder.

| Credential ID              | Jenkins kind                  | Value                                                                                                                                       |
| -------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `cambo-ghcr`               | Username with password        | GitHub username and a classic PAT with `write:packages` and write access to the five existing GHCR packages                                 |
| `cambo-deploy-key`         | SSH Username with private key | Username `deploy`, with a dedicated non-interactive SSH key authorized on the server using `restrict,command="/usr/local/bin/cambo-deploy"` |
| `cambo-deploy-known-hosts` | Secret file                   | The verified SSH host key entry for the exact hostname or IPv4 address in `DEPLOY_HOST`                                                     |

After the changes are on GitHub and the checks-only build passes, set the repository variable `JENKINS_RELEASE_ENABLED=true` and let any in-flight GitHub image publishing and deploy runs finish. GitHub Actions will still test, build the Docker images and run the Compose smoke test. Jenkins takes over publishing and automatic GitHub deployment is disabled. The manual GitHub deploy workflow can still roll back to an already published commit. To hand releases back to GitHub, clear the variable and verify `DEPLOY_ENABLED=true`.

Run **Build with Parameters** with `RELEASE` enabled. Set the public HTTPS origin, production Telegram bot username, and Droplet SSH host. Jenkins publishes missing `sha-<commit>` image tags and reuses any already published for that commit. Use a new commit if the baked-in web settings need to change. Once all five tags exist, Jenkins invokes the existing server script for the current commit on `main`. That script backs up the databases, deploys the images, verifies readiness and the public catalog, and rolls back a failed release. The app server still needs its production environment, Docker Compose and access to read the GHCR packages.

## Terraform

The [Terraform configuration](../infra/terraform/main.tf) defines a Droplet and a Cloud Firewall for a Cloudflare Tunnel deployment. It defaults to a 1 GB Ubuntu Droplet in Singapore. The firewall allows inbound SSH from the CIDRs you supply, while the Tunnel makes its outbound connection. Before attaching it to the live Droplet, include your administrator IP and the egress addresses of every runner that still deploys there. If handing releases back to GitHub Actions, verify that the GitHub runner can reach SSH through your chosen network setup.

From the repository root, run:

```bash
cp infra/terraform/terraform.tfvars.example infra/terraform/terraform.tfvars
# Edit terraform.tfvars. Supply your registered SSH key fingerprint and allowed CIDRs.
# Set DIGITALOCEAN_TOKEN in your shell using a token scoped to the resources you manage.
terraform -chdir=infra/terraform init
terraform -chdir=infra/terraform validate
```

**To manage your existing live Droplet**, match its name, region, size, image, backups and IPv6 settings in `terraform.tfvars` and import it before planning. Import the existing cloud firewall too if Terraform should manage it. Review every planned change, including the SSH allowlist, and investigate any replacement or resize before applying.

```bash
terraform -chdir=infra/terraform import digitalocean_droplet.shop <droplet-id>
terraform -chdir=infra/terraform import digitalocean_firewall.shop <firewall-id> # If adopting an existing firewall
terraform -chdir=infra/terraform plan -out=cambo.tfplan
```

**For a new Droplet**, choose a separate name and skip the import commands. Review a plan that creates a new Droplet and firewall. After either workflow, apply the reviewed plan with `terraform -chdir=infra/terraform apply cambo.tfplan`. Bootstrap a new Droplet using the [deployment guide](deployment.md#4a-on-a-1-gb-server). Keep Terraform state in a secure, backed-up location and use a shared remote backend if multiple people will manage the infrastructure.

[DigitalOcean Droplet resource](https://docs.digitalocean.com/reference/terraform/reference/resources/droplet/) · [DigitalOcean Cloud Firewall resource](https://docs.digitalocean.com/reference/terraform/reference/resources/firewall/)
