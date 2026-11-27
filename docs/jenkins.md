# Jenkins

The Jenkins controller runs on the DigitalOcean Droplet. A build agent runs the tests, builds the app, and exercises the Compose stack. GitHub Actions handles CamboKB's production releases.

## Run the course demo

Start Docker Desktop on the Mac, then open `~/Applications/Start CamboKB Jenkins Agent.command`. Leave its Terminal window open while the job runs. Open [CamboKB in Jenkins](http://127.0.0.1:18090/job/CamboKB/), sign in as `admin` using the `CamboKB Jenkins` password in Keychain, and select **Build with Parameters** with **RELEASE unchecked**.

## Configure a controller and agent

1. Copy [the controller Compose file](../jenkins/compose.yml) to a separate directory on the Droplet, such as `/opt/cambo-jenkins`, as `compose.yml`. From that directory run `docker compose up -d`. Jenkins stores its configuration in a named volume, listens on loopback port 8090, and defaults to a 512 MiB memory limit and half a CPU. Set `JENKINS_MEMORY_LIMIT` or `JENKINS_CPUS` to adjust these limits. If 8090 is occupied, set `JENKINS_HTTP_PORT` and use the new server port in the SSH forward below. On the 1 GB Droplet, check that the shop remains healthy while Jenkins starts and installs plugins.
2. Use an administrator SSH account that allows forwarding. The restricted production deploy key is for the pipeline's deploy step.

   ```bash
   ssh -N -L 18090:127.0.0.1:8090 <admin>@<droplet>
   ```

   Open `http://127.0.0.1:18090`. For a new controller, fetch the one-time password from the Droplet's controller directory with `docker compose exec controller cat /var/jenkins_home/secrets/initialAdminPassword`. Install Pipeline, Pipeline: Declarative, Git, Credentials Binding, and SSH Credentials, then set the built-in node's executor count to zero.

3. Create an inbound agent with the label `cambo-linux` and one executor. Start it on a Mac or Linux build machine using WebSocket and the forwarded controller URL. Install Java 21 or later, Node 22 and npm, Git, OpenSSH client, Bash, curl, the PostgreSQL client (`psql`), Puppeteer's Chromium system libraries, and Docker with Compose 2.24.4+ and Buildx. The agent must be able to run Docker and bind the smoke test's local ports (18080, 15432, 13001, 19090). If necessary, set `JENKINS_SMOKE_WEB_PORT`, `JENKINS_SMOKE_DB_PORT`, `JENKINS_SMOKE_GRAFANA_PORT`, and `JENKINS_SMOKE_PROMETHEUS_PORT` in the agent environment.
4. Create a **Pipeline** job with **Pipeline script from SCM**, your GitHub repository URL, branch `*/main` and script path `Jenkinsfile`. Use a trusted main-only job for release credentials. Start with **RELEASE unchecked** to run the tests, build the app, and test the Compose stack. Jenkins polls GitHub every five minutes after the first run.

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
