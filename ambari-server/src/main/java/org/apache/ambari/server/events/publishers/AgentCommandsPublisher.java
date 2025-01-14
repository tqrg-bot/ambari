/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package org.apache.ambari.server.events.publishers;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

import org.apache.ambari.server.AmbariException;
import org.apache.ambari.server.agent.AgentCommand;
import org.apache.ambari.server.agent.CancelCommand;
import org.apache.ambari.server.agent.ExecutionCommand;
import org.apache.ambari.server.agent.stomp.dto.ExecutionCommandsCluster;
import org.apache.ambari.server.events.ExecutionCommandEvent;
import org.apache.ambari.server.orm.dao.HostRoleCommandDAO;
import org.apache.ambari.server.serveraction.kerberos.KerberosIdentityDataFileReader;
import org.apache.ambari.server.serveraction.kerberos.KerberosIdentityDataFileReaderFactory;
import org.apache.ambari.server.serveraction.kerberos.KerberosServerAction;
import org.apache.ambari.server.state.Clusters;
import org.apache.ambari.server.utils.StageUtils;
import org.apache.commons.codec.binary.Base64;
import org.apache.commons.codec.digest.DigestUtils;
import org.apache.commons.io.IOUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.google.common.collect.ArrayListMultimap;
import com.google.common.collect.Multimap;
import com.google.inject.Inject;
import com.google.inject.Singleton;

@Singleton
public class AgentCommandsPublisher {
  private static final Logger LOG = LoggerFactory.getLogger(AgentCommandsPublisher.class);

  /**
   * KerberosIdentityDataFileReaderFactory used to create KerberosIdentityDataFileReader instances
   */
  @Inject
  private KerberosIdentityDataFileReaderFactory kerberosIdentityDataFileReaderFactory;

  @Inject
  private Clusters clusters;

  @Inject
  private HostRoleCommandDAO hostRoleCommandDAO;

  @Inject
  private StateUpdateEventPublisher stateUpdateEventPublisher;

  public void sendAgentCommand(Multimap<Long, AgentCommand> agentCommands) throws AmbariException {
    if (agentCommands != null && !agentCommands.isEmpty()) {
      Map<Long, TreeMap<String, ExecutionCommandsCluster>> executionCommandsClusters = new TreeMap<>();
      for (Map.Entry<Long, AgentCommand> acHostEntry : agentCommands.entries()) {
        Long hostId = acHostEntry.getKey();
        AgentCommand ac = acHostEntry.getValue();
        populateExecutionCommandsClusters(executionCommandsClusters, hostId, ac);
      }
      for (Map.Entry<Long, TreeMap<String, ExecutionCommandsCluster>> hostEntry : executionCommandsClusters.entrySet()) {
        Long hostId = hostEntry.getKey();
        ExecutionCommandEvent executionCommandEvent = new ExecutionCommandEvent(hostEntry.getValue());
        executionCommandEvent.setHostId(hostId);
        stateUpdateEventPublisher.publish(executionCommandEvent);
      }
    }
  }

  public void sendAgentCommand(Long hostId, AgentCommand agentCommand) throws AmbariException {
    Multimap<Long, AgentCommand> agentCommands = ArrayListMultimap.create();
    agentCommands.put(hostId, agentCommand);
    sendAgentCommand(agentCommands);
  }

  private void populateExecutionCommandsClusters(Map<Long, TreeMap<String, ExecutionCommandsCluster>> executionCommandsClusters,
                                            Long hostId, AgentCommand ac) throws AmbariException {
    try {
      if (LOG.isDebugEnabled()) {
        LOG.debug("Sending command string = " + StageUtils.jaxbToString(ac));
      }
    } catch (Exception e) {
      throw new AmbariException("Could not get jaxb string for command", e);
    }
    switch (ac.getCommandType()) {
      case BACKGROUND_EXECUTION_COMMAND:
      case EXECUTION_COMMAND: {
        ExecutionCommand ec = (ExecutionCommand) ac;
        LOG.info("AgentCommandsPublisher.sendCommands: sending ExecutionCommand for host {}, role {}, roleCommand {}, and command ID {}, task ID {}",
            ec.getHostname(), ec.getRole(), ec.getRoleCommand(), ec.getCommandId(), ec.getTaskId());
        Map<String, String> hlp = ec.getCommandParams();
        if (hlp != null) {
          String customCommand = hlp.get("custom_command");
          if ("SET_KEYTAB".equalsIgnoreCase(customCommand) || "REMOVE_KEYTAB".equalsIgnoreCase(customCommand)) {
            LOG.info(String.format("%s called", customCommand));
            try {
              injectKeytab(ec, customCommand, clusters.getHostById(hostId).getHostName());
            } catch (IOException e) {
              throw new AmbariException("Could not inject keytab into command", e);
            }
          }
        }
        String clusterName = ec.getClusterName();
        String clusterId = "-1";
        if (clusterName != null) {
          clusterId = Long.toString(clusters.getCluster(clusterName).getClusterId());
        }
        ec.setClusterId(clusterId);
        prepareExecutionCommandsClusters(executionCommandsClusters, hostId, clusterId);
        executionCommandsClusters.get(hostId).get(clusterId).getExecutionCommands().add((ExecutionCommand) ac);
        break;
      }
      case CANCEL_COMMAND: {
        CancelCommand cc = (CancelCommand) ac;
        String clusterId = Long.toString(hostRoleCommandDAO.findByPK(cc.getTargetTaskId()).getStage().getClusterId());
        prepareExecutionCommandsClusters(executionCommandsClusters, hostId, clusterId);
        executionCommandsClusters.get(hostId).get(clusterId).getCancelCommands().add(cc);
        break;
      }
      default:
        LOG.error("There is no action for agent command ="
            + ac.getCommandType().name());
    }
  }

  private void prepareExecutionCommandsClusters(Map<Long, TreeMap<String, ExecutionCommandsCluster>> executionCommandsClusters,
                                                Long hostId, String clusterId) {
    if (!executionCommandsClusters.containsKey(hostId)) {
      executionCommandsClusters.put(hostId, new TreeMap<>());
    }
    if (!executionCommandsClusters.get(hostId).containsKey(clusterId)) {
      executionCommandsClusters.get(hostId).put(clusterId, new ExecutionCommandsCluster(new ArrayList<>(),
          new ArrayList<>()));
    }
  }

  /**
   * Insert Kerberos keytab details into the ExecutionCommand for the SET_KEYTAB custom command if
   * any keytab details and associated data exists for the target host.
   *
   * @param ec the ExecutionCommand to update
   * @param command a name of the relevant keytab command
   * @param targetHost a name of the host the relevant command is destined for
   * @throws AmbariException
   */
  void injectKeytab(ExecutionCommand ec, String command, String targetHost) throws AmbariException {
    String dataDir = ec.getCommandParams().get(KerberosServerAction.DATA_DIRECTORY);

    if (dataDir != null) {
      KerberosIdentityDataFileReader reader = null;
      List<Map<String, String>> kcp = ec.getKerberosCommandParams();

      try {
        reader = kerberosIdentityDataFileReaderFactory.createKerberosIdentityDataFileReader(new File(dataDir, KerberosIdentityDataFileReader.DATA_FILE_NAME));

        for (Map<String, String> record : reader) {
          String hostName = record.get(KerberosIdentityDataFileReader.HOSTNAME);

          if (targetHost.equalsIgnoreCase(hostName)) {

            if ("SET_KEYTAB".equalsIgnoreCase(command)) {
              String keytabFilePath = record.get(KerberosIdentityDataFileReader.KEYTAB_FILE_PATH);

              if (keytabFilePath != null) {

                String sha1Keytab = DigestUtils.sha1Hex(keytabFilePath);
                File keytabFile = new File(dataDir + File.separator + hostName + File.separator + sha1Keytab);

                if (keytabFile.canRead()) {
                  Map<String, String> keytabMap = new HashMap<>();
                  String principal = record.get(KerberosIdentityDataFileReader.PRINCIPAL);
                  String isService = record.get(KerberosIdentityDataFileReader.SERVICE);

                  keytabMap.put(KerberosIdentityDataFileReader.HOSTNAME, hostName);
                  keytabMap.put(KerberosIdentityDataFileReader.SERVICE, isService);
                  keytabMap.put(KerberosIdentityDataFileReader.COMPONENT, record.get(KerberosIdentityDataFileReader.COMPONENT));
                  keytabMap.put(KerberosIdentityDataFileReader.PRINCIPAL, principal);
                  keytabMap.put(KerberosIdentityDataFileReader.KEYTAB_FILE_PATH, keytabFilePath);
                  keytabMap.put(KerberosIdentityDataFileReader.KEYTAB_FILE_OWNER_NAME, record.get(KerberosIdentityDataFileReader.KEYTAB_FILE_OWNER_NAME));
                  keytabMap.put(KerberosIdentityDataFileReader.KEYTAB_FILE_OWNER_ACCESS, record.get(KerberosIdentityDataFileReader.KEYTAB_FILE_OWNER_ACCESS));
                  keytabMap.put(KerberosIdentityDataFileReader.KEYTAB_FILE_GROUP_NAME, record.get(KerberosIdentityDataFileReader.KEYTAB_FILE_GROUP_NAME));
                  keytabMap.put(KerberosIdentityDataFileReader.KEYTAB_FILE_GROUP_ACCESS, record.get(KerberosIdentityDataFileReader.KEYTAB_FILE_GROUP_ACCESS));

                  BufferedInputStream bufferedIn = new BufferedInputStream(new FileInputStream(keytabFile));
                  byte[] keytabContent = null;
                  try {
                    keytabContent = IOUtils.toByteArray(bufferedIn);
                  } finally {
                    bufferedIn.close();
                  }
                  String keytabContentBase64 = Base64.encodeBase64String(keytabContent);
                  keytabMap.put(KerberosServerAction.KEYTAB_CONTENT_BASE64, keytabContentBase64);

                  kcp.add(keytabMap);
                }
              }
            } else if ("REMOVE_KEYTAB".equalsIgnoreCase(command)) {
              Map<String, String> keytabMap = new HashMap<>();

              keytabMap.put(KerberosIdentityDataFileReader.HOSTNAME, hostName);
              keytabMap.put(KerberosIdentityDataFileReader.SERVICE, record.get(KerberosIdentityDataFileReader.SERVICE));
              keytabMap.put(KerberosIdentityDataFileReader.COMPONENT, record.get(KerberosIdentityDataFileReader.COMPONENT));
              keytabMap.put(KerberosIdentityDataFileReader.PRINCIPAL, record.get(KerberosIdentityDataFileReader.PRINCIPAL));
              keytabMap.put(KerberosIdentityDataFileReader.KEYTAB_FILE_PATH, record.get(KerberosIdentityDataFileReader.KEYTAB_FILE_PATH));

              kcp.add(keytabMap);
            }
          }
        }
      } catch (IOException e) {
        throw new AmbariException("Could not inject keytabs to enable kerberos");
      } finally {
        if (reader != null) {
          try {
            reader.close();
          } catch (Throwable t) {
            // ignored
          }
        }
      }

      ec.setKerberosCommandParams(kcp);
    }
  }
}
