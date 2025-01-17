/*
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 * <p>
 * http://www.apache.org/licenses/LICENSE-2.0
 * <p>
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
package org.apache.ambari.server.agent.stomp;

import java.util.Collection;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.stream.Collectors;

import org.apache.ambari.server.AmbariException;
import org.apache.ambari.server.ClusterNotFoundException;
import org.apache.ambari.server.agent.stomp.dto.TopologyCluster;
import org.apache.ambari.server.agent.stomp.dto.TopologyComponent;
import org.apache.ambari.server.agent.stomp.dto.TopologyHost;
import org.apache.ambari.server.controller.AmbariManagementControllerImpl;
import org.apache.ambari.server.events.TopologyAgentUpdateEvent;
import org.apache.ambari.server.events.TopologyUpdateEvent;
import org.apache.ambari.server.state.Cluster;
import org.apache.ambari.server.state.Clusters;
import org.apache.ambari.server.state.Host;
import org.apache.ambari.server.state.Service;
import org.apache.ambari.server.state.ServiceComponent;
import org.apache.ambari.server.state.ServiceComponentHost;
import org.apache.ambari.server.state.StackId;
import org.apache.commons.collections.CollectionUtils;

import com.google.inject.Inject;
import com.google.inject.Singleton;

@Singleton
public class TopologyHolder extends AgentClusterDataHolder<TopologyUpdateEvent> {

  @Inject
  private AmbariManagementControllerImpl ambariManagementController;

  @Inject
  private Clusters clusters;

  @Override
  public TopologyUpdateEvent getUpdateIfChanged(String agentHash) throws AmbariException {
    TopologyUpdateEvent topologyUpdateEvent = super.getUpdateIfChanged(agentHash);
    prepareAgentTopology(topologyUpdateEvent);
    return topologyUpdateEvent;
  }

  /**
   * Is used during agent registering to provide base info about clusters topology.
   * @return filled TopologyUpdateEvent with info about all components and hosts in all clusters
   */
  @Override
  public TopologyUpdateEvent getCurrentData() throws AmbariException {
    TreeMap<String, TopologyCluster> topologyClusters = new TreeMap<>();
    for (Cluster cl : clusters.getClusters().values()) {
      Collection<Host> clusterHosts = cl.getHosts();
      Set<TopologyComponent> topologyComponents = new HashSet<>();
      Set<TopologyHost> topologyHosts = new HashSet<>();
      for (Host host : clusterHosts) {
        topologyHosts.add(new TopologyHost(host.getHostId(), host.getHostName(),
            host.getRackInfo(), host.getIPv4()));
      }
      for (Service service : cl.getServices().values()) {
        for (ServiceComponent component : service.getServiceComponents().values()) {
          Map<String, ServiceComponentHost> componentsMap = component.getServiceComponentHosts();
          if (!componentsMap.isEmpty()) {

            //TODO will be a need to change to multi-instance usage
            ServiceComponentHost sch = componentsMap.entrySet().iterator().next().getValue();

            Set<String> hostNames = cl.getHosts(sch.getServiceName(), sch.getServiceComponentName());
            Set<Long> hostOrderIds = clusterHosts.stream()
              .filter(h -> hostNames.contains(h.getHostName()))
              .map(Host::getHostId)
              .collect(Collectors.toSet());
            String serviceName = sch.getServiceName();
            String componentName = sch.getServiceComponentName();
            StackId stackId = cl.getDesiredStackVersion();

            TopologyComponent topologyComponent = TopologyComponent.newBuilder()
                .setComponentName(sch.getServiceComponentName())
                .setServiceName(sch.getServiceName())
                .setVersion(sch.getVersion())
                .setHostIds(hostOrderIds)
                .setComponentLevelParams(ambariManagementController.getTopologyComponentLevelParams(stackId, serviceName,
                    componentName, cl.getSecurityType()))
                .setCommandParams(ambariManagementController.getTopologyCommandParams(stackId, serviceName, componentName))
                .build();
            topologyComponents.add(topologyComponent);
          }
        }
      }
      topologyClusters.put(Long.toString(cl.getClusterId()),
          new TopologyCluster(topologyComponents, topologyHosts));
    }
    return new TopologyUpdateEvent(topologyClusters, TopologyUpdateEvent.EventType.CREATE);
  }

  @Override
  public boolean updateData(TopologyUpdateEvent update) throws AmbariException {
    boolean changed = super.updateData(update);
    if (changed) {
      // it is not allowed to change existent update event before arriving to listener and converting to json
      // so it is better to create copy
      TopologyUpdateEvent copiedUpdate = update.deepCopy();
      TopologyAgentUpdateEvent topologyAgentUpdateEvent = new TopologyAgentUpdateEvent(copiedUpdate.getClusters(),
        copiedUpdate.getHash(),
        copiedUpdate.getEventType()
      );
      prepareAgentTopology(topologyAgentUpdateEvent);
      stateUpdateEventPublisher.publish(topologyAgentUpdateEvent);
    }

    return changed;
  }

  @Override
  protected boolean handleUpdate(TopologyUpdateEvent update) throws AmbariException {
    boolean changed = false;
    TopologyUpdateEvent.EventType eventType = update.getEventType();
    for (Map.Entry<String, TopologyCluster> updatedCluster : update.getClusters().entrySet()) {
      String clusterId = updatedCluster.getKey();
      TopologyCluster cluster = updatedCluster.getValue();
      if (getData().getClusters().containsKey(clusterId)) {
        if (eventType.equals(TopologyUpdateEvent.EventType.DELETE) &&
            CollectionUtils.isEmpty(getData().getClusters().get(clusterId).getTopologyComponents()) &&
            CollectionUtils.isEmpty(getData().getClusters().get(clusterId).getTopologyHosts())) {
          getData().getClusters().remove(clusterId);
          changed = true;
        } else {
          getData().getClusters().get(clusterId).update(update.getClusters().get(clusterId).getTopologyComponents(),
              update.getClusters().get(clusterId).getTopologyHosts(), eventType);
          changed = true; // TODO check if really changed
        }
      } else {
        if (eventType.equals(TopologyUpdateEvent.EventType.UPDATE)) {
          getData().getClusters().put(clusterId, cluster);
          changed = true;
        } else {
          throw new ClusterNotFoundException(Long.parseLong(clusterId));
        }
      }
    }
    return changed;
  }

  private void prepareAgentTopology(TopologyUpdateEvent topologyUpdateEvent) {
    if (topologyUpdateEvent.getClusters() != null) {
      for (TopologyCluster topologyCluster : topologyUpdateEvent.getClusters().values()) {
        for (TopologyComponent topologyComponent : topologyCluster.getTopologyComponents()) {
          topologyComponent.setHostNames(new HashSet<>());
          topologyComponent.setPublicHostNames(new HashSet<>());
        }
      }
    }
  }

  @Override
  protected TopologyUpdateEvent getEmptyData() {
    return TopologyUpdateEvent.emptyUpdate();
  }
}
